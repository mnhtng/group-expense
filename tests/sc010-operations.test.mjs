import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {spawnSync} from "node:child_process";
import {classifyOpsOutcome,operationalAlerts,OPS_LIMITS}
  from "../lib/settlement-cycles/ops-policy.ts";

const read=p=>readFileSync(p,"utf8");
function outcome({
  recurringGenerated=0,recurringErrors=0,cycleGroups=0,cycleErrors=0,
  pushClaimed=0,remindersAttempted=0,reminderPushClaimed=0,
  stages={},
}={}){
  const counters={
    recurring:{generated:recurringGenerated,ignored:0,paused:0,errors:recurringErrors},
    push:{claimed:pushClaimed,sent:0,disabled:false},
    cycles:stages.cycles==="deferred"?null:
      {groups:cycleGroups,created:0,reviewed:0,skipped:0,
        errors:cycleErrors,metadataOnly:true},
    reminders:{disabled:false,candidates:remindersAttempted,
      attempted:remindersAttempted,inserted:0},
    reminderPush:{claimed:reminderPushClaimed,sent:0,disabled:false},
  };
  return classifyOpsOutcome(counters,{
    recurring:"ok",push:"ok",cycles:"ok",reminders:"ok",reminderPush:"ok",
    ...stages,
  });
}
test("SC-010 success requires nonfailed, below-cap pipeline and completed upstream catch-up",()=>{
  const result=outcome();
  assert.equal(result.status,"success");
  assert.deepEqual(result.warningCodes,[]);
  assert.equal(OPS_LIMITS.recurring,20);
  assert.equal(OPS_LIMITS.groups,30);
  assert.equal(OPS_LIMITS.perGroup,24);
});
test("SC-010 failure and backlog are never silently declared done",()=>{
  assert.equal(outcome({recurringErrors:1}).status,"failed");
  assert.ok(outcome({recurringErrors:1}).warningCodes.includes("RECURRING_FAILED"));
  assert.equal(outcome({cycleErrors:1}).status,"failed");
  assert.equal(outcome({stages:{push:"failed"}}).status,"failed");
  assert.equal(outcome({stages:{cycles:"deferred"}}).status,"partial");
  assert.ok(outcome({stages:{cycles:"deferred"}}).warningCodes
    .includes("CYCLES_WAITING_FOR_RECURRING"));
  for(const scenario of [
    {recurringGenerated:20},{cycleGroups:30},{pushClaimed:30},
    {remindersAttempted:40},{reminderPushClaimed:30},
  ])assert.equal(outcome(scenario).status,"partial",
    "capacity is a soft backlog warning, not verified completion");
  const incomplete=outcome();
  incomplete.counters.recurring.hasMoreRules=true;
  assert.ok(classifyOpsOutcome(incomplete.counters,incomplete.stages)
    .warningCodes.includes("RECURRING_SCAN_INCOMPLETE"));
  incomplete.counters.recurring.hasMoreRules=false;
  incomplete.counters.cycles.hasMoreGroups=true;
  incomplete.counters.cycles.atCapacityGroups=2;
  const cycleBacklog=classifyOpsOutcome(incomplete.counters,incomplete.stages);
  assert.equal(cycleBacklog.status,"partial");
  assert.ok(cycleBacklog.warningCodes.includes("CYCLE_PERIODS_AT_CAP"));
  assert.ok(cycleBacklog.warningCodes.includes("CYCLE_GROUP_SCAN_INCOMPLETE"));
});
test("SC-010 operational monitor recognizes stale/failed runs and overdue manual work",()=>{
  const nowMs=Date.parse("2026-11-05T20:00:00.000Z");
  const normal={latestCompletedAt:"2026-11-05T10:00:00.000Z",
    latestStatus:"success",staleRunning:0,failedCheckpoints:0,
    recurringFailedCheckpoints:0,deadPushJobs:0,overdueReviews:0,nowMs};
  assert.deepEqual(operationalAlerts(normal),[]);
  assert.deepEqual(operationalAlerts({...normal,latestCompletedAt:null}),
    ["NO_COMPLETED_CRON_RUN"]);
  const stale=operationalAlerts({...normal,
    latestCompletedAt:"2026-11-02T10:00:00.000Z",
    latestStatus:"failed",staleRunning:1,failedCheckpoints:2,
    recurringFailedCheckpoints:1,deadPushJobs:3,overdueReviews:4});
  for(const code of ["CRON_LAST_RUN_OLDER_THAN_36_HOURS",
    "LAST_RUN_NEEDS_OPERATOR_REVIEW","STUCK_CRON_RUN",
    "RECENT_GROUP_CHECKPOINT_ERRORS","RECENT_RECURRING_CHECKPOINT_ERRORS",
    "DEAD_PUSH_DELIVERIES",
    "CYCLES_AWAITING_HUMAN_REVIEW"]){
    assert.ok(stale.includes(code),code);
  }
});
test("SC-010 bearer-only operations are auditable, non-overlapping and never enable finance",()=>{
  const runner=read("lib/settlement-cycles/ops-runner.ts");
  const route=read("app/api/internal/push-drain/route.ts");
  const health=read("app/api/internal/settlement-ops/status/route.ts");
  const auth=read("lib/settlement-cycles/ops-auth.ts");
  const sql=read("db/migrations/023_settlement_cycle_operational_runs.sql");
  assert.match(runner,/pg_try_advisory_lock/);
  assert.match(runner,/pg_advisory_unlock/);
  assert.match(runner,/finally\s*\{/);
  assert.match(runner,/settlement_cycle_operational_runs/);
  assert.match(runner,/recurring\.value\.errors===0&&/);
  assert.match(runner,/recurring\.value\.generated<OPS_LIMITS\.recurring/);
  assert.ok(runner.indexOf("generateDueRecurringExpenses")<
    runner.indexOf("processCycleMetadataCron("));
  assert.match(runner,/classifyOpsOutcome/);
  assert.match(auth,/timingSafeEqual/);
  assert.match(auth,/CRON_SECRET/);
  for(const handler of [route,health])assert.match(handler,/authorizedOpsRequest/);
  assert.match(route,/x-ops-replay-reason/);
  assert.match(route,/mode==="manual-replay"/);
  assert.match(route,/status:202/);
  assert.match(route,/status:outcome\.status==="success"\?200:503/);
  assert.match(health,/status:snapshot\.health==="ok"\?200:503/);
  assert.match(sql,/completed operational run is immutable/);
  assert.match(sql,/operational run history cannot be deleted/);
  assert.doesNotMatch(route,/SETTLEMENT_CYCLE_ENGINE_READY\s*=\s*true/);
  assert.match(read("lib/settlement-cycles/settings.ts"),
    /SETTLEMENT_CYCLE_ENGINE_READY = false/);
});
test("SC-010 recurring >200 and cycle >30 work are explicitly flagged instead of silently starved",()=>{
  const recurring=read("lib/recurring/service.ts");
  const cycle=read("lib/settlement-cycles/lifecycle.ts");
  const runner=read("lib/settlement-cycles/ops-runner.ts");
  const sql=read("db/migrations/023_settlement_cycle_operational_runs.sql");
  assert.match(recurring,/LEFT JOIN recurring_cron_checkpoints cp/);
  assert.match(recurring,/ORDER BY cp\.last_checked_at ASC NULLS FIRST/);
  assert.match(recurring,/LIMIT 201/);
  assert.match(recurring,/rows\.rows\.slice\(0,200\)/);
  assert.match(recurring,/hasMoreRules=rows\.rows\.length>result\.checked/);
  assert.match(recurring,/unnest\(\$1::uuid\[\],\$2::boolean\[\]\)/);
  assert.match(cycle,/LIMIT \$1\`,\[maxGroups\+1\]\)/);
  assert.match(cycle,/hasMoreGroups:candidates\.rows\.length>maxGroups/);
  assert.match(cycle,/atCapacityGroups\+\+/);
  assert.match(runner,/!recurring\.value\.hasMoreRules/);
  assert.match(sql,/CREATE TABLE recurring_cron_checkpoints/);
});

test("SC-010 real restore command rejects every non-disposable URL and cannot target Neon",()=>{
  const bash=read("scripts/sc010-restore-drill.sh");
  const checker=read("db/sc010-restore-verify.mjs");
  assert.ok(bash.includes("postgresql://test:test@localhost:5432/group_expense"));
  assert.ok(checker.includes("postgresql://test:test@localhost:5432/group_expense_sc010_restore"));
  assert.match(bash,/pg_dump/);
  assert.match(bash,/pg_restore/);
  assert.match(bash,/--exit-on-error/);
  assert.match(checker,/sha256/);
  assert.match(checker,/canonical_live_balances/);
  assert.match(checker,/noncash_allocations/);
  assert.match(checker,/dispute_history/);
  assert.match(checker,/schema_versions/);
  const rejected=spawnSync("bash",["scripts/sc010-restore-drill.sh"],{
    encoding:"utf8",env:{...process.env,CI:"false",
      SC010_TEST_ONLY:"isolated-pg17",DATABASE_URL:
        "postgresql://some-shared-db.neon.tech/production"},
  });
  assert.equal(rejected.status,2);
  assert.match(rejected.stderr,/refuses non-disposable/);
  const workflow=read(".github/workflows/sprint1-integration.yml");
  assert.match(workflow,/SC010_TEST_ONLY: isolated-pg17/);
  assert.match(workflow,/bash scripts\/sc010-restore-drill\.sh/);
  assert.ok(workflow.lastIndexOf("test:finance:audit")<
    workflow.lastIndexOf("sc010-restore-drill.sh"));
  assert.doesNotMatch(workflow,/vercel deploy|neon\.tech|git push.*main/);
});
