import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=p=>readFileSync(p,"utf8");

const sql=read("db/migrations/031_automatic_cycle_completion.sql");
const service=read("lib/settlement-cycles/completion.ts");
const detail=read("app/(app)/groups/[groupId]/cycles/[cycleId]/page.tsx");
const history=read("app/(app)/groups/[groupId]/cycles/page.tsx");
const cycle=read("lib/settlement-cycles/lifecycle.ts");

test("completion is append-only, not a new state of the immutable LOCKED snapshot",()=>{
  assert.match(sql,/CREATE TABLE group_settlement_cycle_completions/);
  assert.match(sql,/CHECK \(origin IN \('automatic','backfill'\)\)/);
  assert.match(sql,/sc031_completion_immutable/);
  assert.match(sql,/sc031_completion_no_truncate/);
  assert.match(sql,/SC031 unsettled or blocked period cannot complete/);
  assert.doesNotMatch(sql,/ALTER TABLE group_settlement_cycles[\s\S]*?ADD COLUMN state/);
  assert.match(cycle,/settlementCompletedAt/);
  assert.match(cycle,/state:CycleState/);
  assert.match(history,/cycle\.settlementCompletedAt\?"Hoàn tất"/);
});

test("SQL readiness checks complete frozen source, cash, disputes and incomplete invoices",()=>{
  for(const name of [
    "group_settlement_cycle_snapshot_obligations","bn005_obligation_balances",
    "group_settlement_cycle_snapshot_expenses","group_settlement_bilateral_cash_intents",
    "group_settlement_cycle_repayments","group_settlement_bilateral_heads",
    "group_settlement_bilateral_applications","sc009_dispute_states",
  ])assert.ok(sql.includes(name),name);
  assert.match(sql,/bal\.outstanding_minor<>0/);
  assert.match(sql,/bal\.pending_cash_minor<>0/);
  assert.match(sql,/e\.completed_at IS NULL/);
  assert.match(sql,/ci\.status='pending'/);
  assert.match(sql,/d\.status IN \('open','awaiting_reporter'\)/);
  assert.match(sql,/INSERT INTO group_settlement_cycle_completions[\s\S]*?'backfill'/);
});

test("finance hooks cannot close cycle before second cash attestation or on rejection",()=>{
  const money=read("lib/settlements/service.ts");
  const pair=read("lib/settlement-cycles/paired-cash.ts");
  const app=read("lib/settlement-cycles/applications.ts");
  assert.match(money,/if\(next==="confirmed"\)/);
  assert.match(money,/completeCyclesTouchedByExpenses/);
  assert.match(pair,/if\(updated\.rowCount!==1\)/);
  assert.match(pair,/recordEligibleCycleCompletions\(client,groupId,\[cycleId\],actorId\)/);
  assert.match(app,/recordEligibleCycleCompletions\(client,groupId,\[cycleId\],actorId\)/);
  assert.match(service,/ON CONFLICT\(cycle_id\) DO NOTHING/);
  assert.match(service,/sc031_cycle_ready/);
  assert.match(service,/ORDER BY c\.id/);
});

test("mobile replaces payments on settled cycle with read-only history and summary",()=>{
  assert.match(detail,/✓ Đã quyết toán xong!/);
  assert.match(detail,/Xem tổng kết kỳ/);
  assert.match(detail,/settlementCompletedAt/);
  assert.match(detail,/view==="settle"&&!selected\.settlementCompletedAt/);
  assert.match(detail,/formatDateTimeDMY\(selected\.settlementCompletedAt\)/);
  assert.match(read("components/groups/settlement-cycle-ops-panel.tsx"),
    /report\.settlementCompletedAt/);
});

test("runtime role gets only SELECT/INSERT for new append-only proof",()=>{
  const policy=read("db/rr004-runtime-policy.mjs");
  const inventory=read("db/financial-inventory.mjs");
  assert.match(policy,/group_settlement_cycle_completions/);
  assert.match(policy,/sc031_completion_immutable/);
  assert.match(policy,/sc031_completion_no_truncate/);
  assert.match(inventory,/\["cycle_completion","group_settlement_cycle_completions"/);
});
