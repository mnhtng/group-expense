import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const read=path=>readFileSync(path,"utf8");

test("Manual schedules may start in the past, but automatic schedules and running cutovers remain guarded",()=>{
  const schedule=read("lib/settlement-cycles/schedule.ts");
  assert.match(schedule,/input\.frequency!=="manual"/);
  assert.match(schedule,/input\.anchorDate<=currentLocalDate\(input\.timeZone\)/);
  assert.match(schedule,/input\.frequency==="manual"&&!current/);
  assert.match(schedule,/if\(current\)/);
  assert.match(schedule,/isPeriodBoundary/);
  assert.match(schedule,/group_settlement_cycles/);
});
test("Manual creation can backfill past dates and cannot start in future or overlap",()=>{
  const lifecycle=read("lib/settlement-cycles/lifecycle.ts");
  assert.match(lifecycle,/input\.startDate<rule\.anchorDate/);
  assert.match(lifecycle,/if\(Date\.parse\(startAt\)>now\)/);
  assert.match(lifecycle,/cancelled_at IS NULL[\s\S]*tstzrange/);
  assert.match(lifecycle,/period_start.*period_end/);
  assert.match(lifecycle,/input\.endDate\)-Date\.parse\(input\.startDate/);
  assert.doesNotMatch(lifecycle,/Date\.parse\(startAt\)<await activationEpoch\(client,groupId\)/);
});
test("Unlocked cycle edits/deletion require owner/delegate, draft version and audit",()=>{
  const lifecycle=read("lib/settlement-cycles/lifecycle.ts");
  const route=read("app/api/groups/[groupId]/settlement-cycle/cycles/[cycleId]/route.ts");
  const schema=read("db/migrations/026_manual_cycle_drafts.sql");
  for(const name of ["updateManualSettlementCycle","cancelManualSettlementCycle"])
    assert.match(lifecycle,new RegExp(`export async function ${name}`));
  assert.match(lifecycle,/withAuthorizedCycleManager\(groupId,actorId/);
  assert.match(lifecycle,/if\(!\["open","review"\]\.includes\(c\.state\)\)/);
  assert.match(lifecycle,/if\(c\.source!=="manual"\)/);
  assert.match(lifecycle,/assertNoFinancialArtifacts\(client,cycleId\)/);
  assert.match(lifecycle,/c\.draftRevision!==input\.expectedDraftRevision/);
  assert.match(lifecycle,/FOR UPDATE/);
  assert.match(lifecycle,/group_settlement_cycle_draft_events/);
  assert.match(route,/withAuthenticatedApi/);
  assert.match(route,/export const PATCH=/);
  assert.match(route,/export const DELETE=/);
  assert.match(schema,/A cancelled cycle is immutable/);
  assert.match(schema,/old\.state='review'|OLD\.state='review'/);
  assert.match(schema,/Cycle draft history is append-only/);
  assert.match(schema,/sc026_draft_events_no_truncate/);
  assert.match(schema,/DROP CONSTRAINT cycle_revision_start/);
  assert.match(read("db/financial-inventory.mjs"),/cycle_draft_history/);
  assert.match(read("db/rr004-runtime-policy.mjs"),/sc026_draft_events_immutable/);
  assert.match(schema,/WHERE \(cancelled_at IS NULL\)/);
  assert.doesNotMatch(schema,/DROP TABLE (expenses|obligations|settlements)/);
});
test("Review rejects stale draft edits without changing old 1->2->3 lifecycle money semantics",()=>{
  const lifecycle=read("lib/settlement-cycles/lifecycle.ts");
  const review=read("app/api/groups/[groupId]/settlement-cycle/cycles/[cycleId]/review/route.ts");
  const ui=read("components/groups/settlement-cycle-lifecycle-panel.tsx");
  assert.match(lifecycle,/c\.draftRevision!==expectedDraftRevision/);
  assert.match(lifecycle,/draft_revision=\$4/);
  assert.match(lifecycle,/expectedDraftRevision=0/);
  assert.match(review,/expectedDraftRevision===undefined\?0/);
  assert.match(ui,/expectedDraftRevision:cycle\.draftRevision/);
  assert.match(ui,/cycle\.state!=="locked"&&schedule\.canManage/);
  assert.match(ui,/cycle\.source==="manual"&&<button/);
  assert.match(ui,/Xác nhận xóa kỳ/);
  assert.match(ui,/Chuyển sang chờ kiểm tra/);
  assert.match(read("lib/settlement-cycles/snapshot.ts"),/cycle\.version|c\.version/);
  assert.doesNotMatch(lifecycle,/UPDATE (expenses|obligations|settlements|settlement_allocations)/i);
});
test("Cancelled draft cycles vanish from both public list and direct lookup",()=>{
  const source=read("lib/settlement-cycles/lifecycle.ts");
  assert.match(source,/WHERE group_id=\$1 AND cancelled_at IS NULL ORDER BY start_at DESC/);
  assert.match(source,/WHERE group_id=\$1 AND id=\$2 AND cancelled_at IS NULL LIMIT 1/);
  assert.match(source,/cancelled_at=clock_timestamp\(\)/);
  assert.match(source,/period_cancelled/);
});

test("Cancelled manual periods do not block archive, future invoices or reconciliation",()=>{
  const schema=read("db/migrations/026_manual_cycle_drafts.sql");
  const archive=read("lib/groups/service.ts");
  const adjustments=read("lib/settlement-cycles/adjustments.ts");
  const snapshot=read("lib/settlement-cycles/snapshot.ts");
  const reconciliation=read("lib/settlement-cycles/reconciliation.ts");
  const repayment=read("lib/settlement-cycles/repayments.ts");
  assert.match(schema,/CREATE OR REPLACE FUNCTION sc006_guard_adjustment/);
  assert.match(schema,/c\.cancelled_at IS NULL/);
  assert.match(archive,/c\.cancelled_at IS NULL/);
  assert.match(adjustments,/WHERE group_id=\$1 AND cancelled_at IS NULL AND period_start/);
  assert.match(snapshot,/c\.cancelled_at IS NULL/);
  assert.match(reconciliation,/cy\.cancelled_at IS NULL/);
  assert.match(repayment,/id=\$1 AND group_id=\$2 AND cancelled_at IS NULL/);
});
test("Append-only draft audit receives constrained runtime grants and recovery digests",()=>{
  const policy=read("db/rr004-runtime-policy.mjs");
  const inventory=read("db/financial-inventory.mjs");
  const sql=read("db/migrations/026_manual_cycle_drafts.sql");
  assert.match(policy,/group_settlement_cycle_draft_events/);
  assert.match(policy,/sc026_draft_events_immutable/);
  assert.match(policy,/sc026_draft_events_no_truncate/);
  assert.match(inventory,/cycle_draft_history/);
  assert.match(sql,/BEFORE UPDATE OR DELETE/);
  assert.match(sql,/BEFORE TRUNCATE/);
});
