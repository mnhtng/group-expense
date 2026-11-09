/** Environment-specific SQL policy; never provisions a live role on import.
 * The role must already exist as a dedicated non-owner LOGIN. Provider role
 * creation, credential handling and applying these grants need approval.
 */
import {FINANCIAL_CLASSES} from './rr003-restore-compare.mjs';

export const APPEND_ONLY_TABLES=Object.freeze([
  'expense_events','expense_completion_events','settlement_events',
  'group_membership_events','group_note_events','group_settlement_config_events',
  'obligation_sources','settlement_allocations','recurring_expense_occurrences',
  'group_settlement_schedule_events','group_settlement_cycle_events',
  'group_settlement_cycle_snapshot_expenses','group_settlement_cycle_snapshot_obligations',
  'group_settlement_cycle_snapshots','group_settlement_cycle_repayments',
  'group_settlement_bilateral_proposals','group_settlement_bilateral_sources',
  'group_settlement_bilateral_decision_events','group_settlement_bilateral_applications',
  'group_settlement_bilateral_application_allocations',
  'group_settlement_bilateral_residual_repayments','group_settlement_cycle_adjustments',
  'group_settlement_cycle_disputes','group_settlement_cycle_dispute_events',
]);
// SELECT FOR UPDATE requires UPDATE on a column, even for immutable records.
// These identifier-only grants rely on the existing immutable UPDATE triggers;
// no actual identifier update is allowed. Never grant audit-body UPDATE.
export const LOCK_COLUMNS=Object.freeze({
  group_settlement_cycle_snapshots:'cycle_id',
  group_settlement_bilateral_proposals:'id',
  group_settlement_bilateral_decision_events:'id',
  group_settlement_bilateral_applications:'id',
  group_settlement_cycle_adjustments:'id',
  group_settlement_cycle_disputes:'id',
  group_settlement_cycle_dispute_events:'id',
});
const deletable=new Set(['user','session','account','verification',
  'expense_items','expense_item_shares','push_subscriptions']);
export const COLUMN_UPDATES=Object.freeze({
  ...Object.fromEntries(Object.entries(LOCK_COLUMNS).map(([t,c])=>[t,[c]])),
  obligations:['voided_at'],settlements:['status','resolved_at','resolved_by'],
  notifications:['read_at'],
});
const lockGuards=['sc004_manifest_immutable','bn002_proposal_immutable',
  'bn003_event_immutable','bn004_app_immutable','sc006_adjustment_guard',
  'sc009_dispute_guard','sc009_dispute_event_guard'];
export const RUNTIME_TABLES=Object.freeze([...FINANCIAL_CLASSES.map(x=>x[1]),'sc009_dispute_states']);
const append=new Set(APPEND_ONLY_TABLES);
const quote=name=>{
  if(typeof name!=='string'||! /^[a-z][a-z0-9_]{0,62}$/.test(name))
    throw Error('RR-004 invalid SQL identifier');
  return '"'+name+'"';
};
export function expectedRuntimePrivileges(table){
  if(!RUNTIME_TABLES.includes(table))throw Error('RR-004 unknown table');
  const readOnly=['schema_migrations','bn005_obligation_balances','sc009_dispute_states'].includes(table);
  return {select:true,insert:!readOnly,
    update:!readOnly&&!append.has(table)&&!COLUMN_UPDATES[table],
    delete:deletable.has(table),columns:COLUMN_UPDATES[table]??[]};
}
export function buildRuntimeGrantSql(roleName){
  const role=quote(roleName);
  const sql=[
    'REVOKE CREATE ON SCHEMA public FROM PUBLIC;',
    'REVOKE TEMPORARY ON DATABASE group_expense FROM PUBLIC;',
    `REVOKE ALL ON DATABASE group_expense FROM ${role};`,
    `GRANT CONNECT ON DATABASE group_expense TO ${role};`,
    `REVOKE ALL ON SCHEMA public FROM ${role};`,
    `GRANT USAGE ON SCHEMA public TO ${role};`,
  ];
  for(const table of RUNTIME_TABLES){
    const t='public.'+quote(table),p=expectedRuntimePrivileges(table);
    sql.push(`REVOKE ALL ON TABLE ${t} FROM ${role};`);
    // Reset the reviewed column grants. The verifier rejects unexpected old
    // column grants; this policy is intended for a fresh dedicated role.
    if(p.columns.length)sql.push(`REVOKE UPDATE (${p.columns.map(quote).join(',')}) ON ${t} FROM ${role};`);
    const privileges=['SELECT',...(p.insert?['INSERT']:[]),...(p.update?['UPDATE']:[]),...(p.delete?['DELETE']:[])];
    sql.push(`GRANT ${privileges.join(',')} ON TABLE ${t} TO ${role};`);
    if(p.columns.length)sql.push(`GRANT UPDATE (${p.columns.map(quote).join(',')}) ON ${t} TO ${role};`);
  }
  return sql.join('\n');
}
export function evaluateRuntimePrivileges(snapshot){
  const blockers=[];
  const r=snapshot?.role;
  if(!r||r.login!==true)blockers.push('ROLE_NOT_LOGIN');
  if(!r||['superuser','createRole','createDb','replication','bypassRls']
    .some(key=>r[key]!==false))
    blockers.push('ADMINISTRATIVE_ROLE');
  if(!Number.isSafeInteger(r?.memberships)||r.memberships!==0)
    blockers.push('ROLE_MEMBERSHIP_ESCALATION');
  for(const [key,code] of [
    ['ownsDatabase','DATABASE_OWNER'],['ownsObjects','OBJECT_OWNER'],
    ['schemaCreate','SCHEMA_CREATE'],['databaseCreate','DATABASE_CREATE'],
    ['temporary','TEMPORARY_OBJECTS'],['securityDefiners','EXECUTABLE_SECURITY_DEFINER'],
  ])if(!r||typeof r[key]!=='boolean'||r[key])blockers.push(code);
  if(r?.lockGuardsPresent!==true)blockers.push('IMMUTABLE_LOCK_GUARD_MISSING');
  const tables=snapshot?.tables;
  if(!Array.isArray(tables)||tables.length!==RUNTIME_TABLES.length||
    new Set(tables.map(t=>t.table)).size!==RUNTIME_TABLES.length||
    tables.some(t=>!RUNTIME_TABLES.includes(t.table)))blockers.push('TABLE_INVENTORY_MISMATCH');
  else for(const t of tables){
    const p=expectedRuntimePrivileges(t.table);
    if(['select','insert','update','delete'].some(k=>t[k]!==p[k])||
      t.truncate!==false||t.trigger!==false||t.references!==false||
      JSON.stringify([...(t.updateColumns??[])].sort())!==JSON.stringify([...p.columns].sort()))
      blockers.push('TABLE_PRIVILEGE_MISMATCH');
  }
  return {ok:blockers.length===0,blockerCodes:[...new Set(blockers)],
    financialEngineReady:false,releaseDecision:'NO-GO',liveRoleCertified:false};
}
export async function readRuntimePrivileges(client){
  const role=(await client.query(`SELECT r.rolcanlogin AS login,r.rolsuper AS superuser,
    r.rolcreaterole AS "createRole",r.rolcreatedb AS "createDb",r.rolreplication AS replication,
    r.rolbypassrls AS "bypassRls",
    (SELECT count(*)::int FROM pg_auth_members WHERE member=r.oid) AS memberships,
    EXISTS(SELECT 1 FROM pg_database WHERE datname=current_database() AND datdba=r.oid) AS "ownsDatabase",
    (EXISTS(SELECT 1 FROM pg_class WHERE relowner=r.oid AND relnamespace='public'::regnamespace)
      OR EXISTS(SELECT 1 FROM pg_proc WHERE proowner=r.oid AND pronamespace='public'::regnamespace)) AS "ownsObjects",
    EXISTS(SELECT 1 FROM pg_namespace WHERE nspname NOT LIKE 'pg_temp_%'
      AND nspname NOT LIKE 'pg_toast_temp_%' AND has_schema_privilege(current_user,oid,'CREATE')) AS "schemaCreate",
    has_database_privilege(current_user,current_database(),'CREATE') AS "databaseCreate",
    has_database_privilege(current_user,current_database(),'TEMPORARY') AS temporary,
    EXISTS(SELECT 1 FROM pg_proc WHERE pronamespace='public'::regnamespace AND prosecdef
      AND has_function_privilege(current_user,oid,'EXECUTE')) AS "securityDefiners",
    (SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
      WHERE c.relnamespace='public'::regnamespace AND t.tgname=ANY($1::text[])
        AND t.tgenabled IN('O','A') AND (t.tgtype::int & 16)<>0)=$2::int AS "lockGuardsPresent"
    FROM pg_roles r WHERE r.rolname=current_user`,[lockGuards,lockGuards.length])).rows[0];
  const tables=(await client.query(`SELECT c.relname AS table,
    has_table_privilege(current_user,c.oid,'SELECT') AS select,
    has_table_privilege(current_user,c.oid,'INSERT') AS insert,
    has_table_privilege(current_user,c.oid,'UPDATE') AS update,
    has_table_privilege(current_user,c.oid,'DELETE') AS delete,
    has_table_privilege(current_user,c.oid,'TRUNCATE') AS truncate,
    has_table_privilege(current_user,c.oid,'TRIGGER') AS trigger,
    has_table_privilege(current_user,c.oid,'REFERENCES') AS references,
    CASE WHEN has_table_privilege(current_user,c.oid,'UPDATE') THEN ARRAY[]::text[]
      ELSE ARRAY(SELECT a.attname::text FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0
        AND NOT a.attisdropped AND has_column_privilege(current_user,c.oid,a.attnum,'UPDATE') ORDER BY a.attname)
      END AS "updateColumns"
    FROM pg_class c WHERE c.relnamespace='public'::regnamespace AND c.relkind IN('r','p','v')
    ORDER BY c.relname`)).rows;
  return {role,tables};
}
