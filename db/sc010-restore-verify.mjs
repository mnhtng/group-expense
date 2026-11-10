/**
 * SC-010 disposable PostgreSQL 17 post-restore verification.
 * Reject any Neon/shared database URL even when somebody sets CI=true.
 * This is NOT a production backup/restore tool.
 */
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import pg from "pg";
import {collectFinancialDigests,compareDigests} from "./rr003-restore-compare.mjs";
import {RR003_TARGET} from "./rr003-recovery-policy.mjs";

const original="postgresql://test:test@localhost:5432/group_expense";
const restored="postgresql://test:test@localhost:5432/group_expense_sc010_restore";
if(process.env.CI!=="true"||
   process.env.SC010_TEST_ONLY!=="isolated-pg17"||
   process.env.DATABASE_URL!==original||
   process.env.RESTORE_DATABASE_URL!==restored){
  console.error("SC-010 restore verification refuses non-disposable database");
  process.exit(2);
}
const from=new pg.Pool({connectionString:original,max:1});
const to=new pg.Pool({connectionString:restored,max:1});
const comparisons=[
  ["schema_versions",`SELECT filename,checksum_sha256
    FROM schema_migrations ORDER BY filename`],
  ["original_obligations",`SELECT id::text,group_id::text,
    debtor_id,creditor_id,amount_minor::text,
    voided_at::text FROM obligations ORDER BY id`],
  ["original_expenses",`SELECT id::text,group_id::text,
    occurred_on::text,payer_id,created_by,total_minor::text,
    completed_at::text,deleted_at::text
    FROM expenses ORDER BY id`],
  ["cash_settlements",`SELECT id::text,group_id::text,
    debtor_id,creditor_id,status,amount_minor::text,
    initiated_by,created_at::text,resolved_at::text,resolved_by
    FROM settlements ORDER BY id`],
  ["cash_allocations",`SELECT settlement_id::text,obligation_id::text,
    group_id::text,amount_minor::text FROM settlement_allocations
    ORDER BY settlement_id,obligation_id`],
  ["noncash_applications",`SELECT id::text,proposal_id::text,
    group_id::text,cycle_id::text,party_low,party_high,
    offset_minor::text,applied_by,created_at::text
    FROM group_settlement_bilateral_applications ORDER BY id`],
  ["noncash_allocations",`SELECT application_id::text,obligation_id::text,
    amount_minor::text FROM group_settlement_bilateral_application_allocations
    ORDER BY application_id,obligation_id`],
  ["locked_sources",`SELECT cycle_id::text,group_id::text,obligation_id::text,
    original_minor::text,confirmed_cash_minor::text,pending_cash_minor::text,
    outstanding_minor::text,available_minor::text
    FROM group_settlement_cycle_snapshot_obligations
    ORDER BY cycle_id,obligation_id`],
  ["late_attribution",`SELECT id::text,group_id::text,
    origin_cycle_id::text,target_cycle_id::text,expense_id::text,
    expense_version,actor_id,created_at::text
    FROM group_settlement_cycle_adjustments ORDER BY id`],
  ["dispute_source",`SELECT id::text,group_id::text,
    cycle_id::text,obligation_id::text,reporter_id,
    counterparty_id,reason,created_at::text
    FROM group_settlement_cycle_disputes ORDER BY id`],
  ["dispute_history",`SELECT id::text,dispute_id::text,
    actor_id,event_type,body,recorded_at::text
    FROM group_settlement_cycle_dispute_events ORDER BY id`],
  ["system_notifications",`SELECT id::text,recipient_id,
    actor_id,group_id::text,settlement_id::text,cycle_id::text,
    kind,event_key,read_at::text,created_at::text
    FROM notifications ORDER BY id`],
  ["cron_evidence",`SELECT id::text,mode,status,
    started_at::text,completed_at::text,stage_results::text
    FROM settlement_cycle_operational_runs ORDER BY id`],
  ["recurring_scan_checkpoints",`SELECT rule_id::text,last_checked_at::text,
    last_error_at::text FROM recurring_cron_checkpoints ORDER BY rule_id`],
  ["canonical_live_balances",`SELECT obligation_id::text,
    original_minor::text,confirmed_cash_minor::text,
    confirmed_setoff_minor::text,pending_cash_minor::text,
    outstanding_minor::text,available_minor::text
    FROM bn005_obligation_balances ORDER BY obligation_id`],
];
async function snapshot(client,query){
  const r=await client.query(query);
  return {rows:r.rowCount??r.rows.length,
    sha256:createHash("sha256").update(JSON.stringify(r.rows)).digest("hex")};
}
const c1=await from.connect();
const c2=await to.connect();
let released=false;
try{
  await Promise.all([
    c1.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY"),
    c2.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY"),
  ]);
  let verified=0;
  for(const [name,sql] of comparisons){
    const [a,b]=await Promise.all([snapshot(c1,sql),snapshot(c2,sql)]);
    assert.deepEqual(b,a,`${name}: restore lost or changed immutable source`);
    verified++;
    console.log("SC-010 restore verified",name,{rows:a.rows,matched:true});
  }
  const migrated=await c2.query(`SELECT count(*)::int AS n
    FROM schema_migrations WHERE filename='023_settlement_cycle_operational_runs.sql'`);
  assert.equal(migrated.rows[0].n,1);
  await Promise.all([c1.query("COMMIT"),c2.query("COMMIT")]);
  c1.release();c2.release();released=true;
  const [baseline,candidate]=await Promise.all([
    collectFinancialDigests(from,RR003_TARGET.sourceBranch,"group_expense"),
    collectFinancialDigests(to,"br-rr003-local-logical-restore","group_expense_sc010_restore"),
  ]);
  const full=compareDigests(baseline,candidate);
  console.log("SC-010 complete",{
    independentSourceComparisons:verified,
    fullRowAndSchemaComparisons:full.checks,
    managedNeonRestore:false,
    financialEngineActivated:false,
  });
}catch(e){
  if(!released)await Promise.allSettled([c1.query("ROLLBACK"),c2.query("ROLLBACK")]);
  console.error("SC-010 restore verification failed",
    e instanceof Error?e.name:"Unknown");
  process.exitCode=1;
}finally{
  if(!released){c1.release();c2.release();}
  await Promise.all([from.end(),to.end()]);
}
