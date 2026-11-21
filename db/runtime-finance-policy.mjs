/**
 * Read-only release gate for the BN-030 paired cash intent table.
 * Runtime privileges must be re-applied AFTER new migrations: existing
 * app roles do not inherit table grants from migration-owner-created tables.
 *
 * The check runs as the REAL DATABASE_URL login, never the migration owner.
 */
export const CASH_INTENT_TABLE="public.group_settlement_bilateral_cash_intents";
export const REQUIRED_UPDATE_COLUMNS=Object.freeze([
  "id","status","resolved_by","resolved_at","application_id","settlement_id",
]);
export const FORBIDDEN_UPDATE_COLUMNS=Object.freeze([
  "amount_minor","group_id","cycle_id","initiated_by","request_key",
]);

export function evaluateCashIntentRuntimePrivileges(state){
  const reasons=[];
  if(state?.migrated!==true)reasons.push("MIGRATION_030_MISSING");
  if(state?.canSelect!==true)reasons.push("CASH_INTENT_SELECT_MISSING");
  if(state?.canInsert!==true)reasons.push("CASH_INTENT_INSERT_MISSING");
  for(const column of REQUIRED_UPDATE_COLUMNS)
    if(state?.allowedUpdates?.[column]!==true)
      reasons.push("CASH_INTENT_UPDATE_"+column.toUpperCase()+"_MISSING");
  if(state?.canDelete!==false)reasons.push("CASH_INTENT_DELETE_NOT_DENIED");
  if(state?.canTruncate!==false)reasons.push("CASH_INTENT_TRUNCATE_NOT_DENIED");
  if(state?.canUpdateAll!==false)reasons.push("CASH_INTENT_UNRESTRICTED_UPDATE");
  for(const column of FORBIDDEN_UPDATE_COLUMNS)
    if(state?.allowedUpdates?.[column]!==false)
      reasons.push("CASH_INTENT_UNEXPECTED_UPDATE_"+column.toUpperCase());
  return {ok:reasons.length===0,reasons};
}

/** Only fixed SQL identifiers; no user input, no secrets or role names. */
export const CASH_INTENT_RUNTIME_PRIVILEGES_SQL=`
SELECT
  EXISTS(SELECT 1 FROM public.schema_migrations
    WHERE filename='030_bilateral_cash_two_actions.sql') AS "migrated",
  has_table_privilege(current_user,
    'public.group_settlement_bilateral_cash_intents','SELECT') AS "canSelect",
  has_table_privilege(current_user,
    'public.group_settlement_bilateral_cash_intents','INSERT') AS "canInsert",
  has_table_privilege(current_user,
    'public.group_settlement_bilateral_cash_intents','UPDATE') AS "canUpdateAll",
  has_table_privilege(current_user,
    'public.group_settlement_bilateral_cash_intents','DELETE') AS "canDelete",
  has_table_privilege(current_user,
    'public.group_settlement_bilateral_cash_intents','TRUNCATE') AS "canTruncate",
  ${[...REQUIRED_UPDATE_COLUMNS,...FORBIDDEN_UPDATE_COLUMNS].map(c=>
    `has_column_privilege(current_user,
      'public.group_settlement_bilateral_cash_intents','${c}','UPDATE') AS "${c}"`
  ).join(",\n  ")}
`;

export function projectCashIntentRuntimePrivileges(row){
  const updates={};
  for(const c of [...REQUIRED_UPDATE_COLUMNS,...FORBIDDEN_UPDATE_COLUMNS])
    updates[c]=row?.[c];
  return {...row,allowedUpdates:updates};
}
