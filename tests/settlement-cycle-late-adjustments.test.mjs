import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=p=>readFileSync(p,"utf8");

test("SC-006 audit is immutable and can never duplicate a source invoice",()=>{
  const sql=read("db/migrations/021_settlement_cycle_late_adjustments.sql");
  assert.match(sql,/sc006_unique_original_invoice UNIQUE\(expense_id\)/);
  assert.match(sql,/sc006_adjustment_request_unique UNIQUE\(group_id,actor_id,request_key\)/);
  assert.match(sql,/SC-006 adjustment audit is immutable/);
  assert.match(sql,/orig\.state<>'locked' OR target\.state<>'review'/);
  assert.match(sql,/bill\.created_at<=old_cutoff AND bill\.updated_at<=old_cutoff/);
  assert.match(sql,/first future unlocked cycle/);
  assert.match(sql,/group_settlement_cycle_snapshot_expenses/);
  assert.doesNotMatch(sql,/INSERT INTO (?:expenses|obligations|settlements|settlement_allocations)/i);
});

test("SC-006 integrates source into later REVIEW snapshot without rewriting historical dates",()=>{
  const snap=read("lib/settlement-cycles/snapshot.ts");
  const sql=read("db/migrations/021_settlement_cycle_late_adjustments.sql");
  assert.match(snap,/adj\.target_cycle_id=\$5 AND adj\.expense_id=e\.id/);
  assert.match(sql,/adj\.target_cycle_id=NEW\.id AND adj\.expense_id=e\.expense_id/);
  assert.match(sql,/CREATE OR REPLACE FUNCTION sc003_guard_cycle\(\)/);
  assert.match(sql,/CREATE OR REPLACE FUNCTION sc004_guard_frozen_items\(\)/);
  assert.match(sql,/CREATE OR REPLACE FUNCTION sc004_guard_frozen_obligation\(\)/);
  assert.match(sql,/Frozen cycle expense can only be creator-completed/);
  assert.match(read("lib/expenses/service.ts"),/group_settlement_cycle_adjustments adj/);
});

test("SC-006 requires manager authority, first next reviewed period and no forged amount",()=>{
  const service=read("lib/settlement-cycles/adjustments.ts");
  const api=read("app/api/groups/[groupId]/settlement-cycle/cycles/[cycleId]/late-adjustments/route.ts");
  assert.match(service,/withAuthorizedCycleManager\(groupId,actorId/);
  assert.match(service,/target\.id!==input\.targetCycleId\|\|target\.state!=="review"/);
  assert.match(service,/expense_version AS "expenseVersion"/);
  assert.match(api,/getCurrentSession\(\)/);
  assert.match(api,/session\.user\.id/);
  assert.match(api,/required=\["expenseId","targetCycleId","expectedExpenseVersion","requestKey"\]/);
  assert.doesNotMatch(api,/amountMinor:fields|actorId:fields|confirmed:fields/);
});

test("SC-006 cron waits for recurring catch-up, and member departure pauses implicated templates",()=>{
  const cron=read("app/api/internal/push-drain/route.ts");
  assert.ok(cron.indexOf("generateDueRecurringExpenses")<cron.indexOf("processCycleMetadataCron(30,24)"));
  assert.match(cron,/recurring\.value\.errors===0 && recurring\.value\.generated<20/);
  const member=read("lib/groups/membership.ts");
  assert.match(member,/uncompletedInvoiceCount/);
  assert.match(member,/creator_confirmation/);
  assert.match(member,/UPDATE recurring_expense_rules r SET status='paused'/);
  assert.match(read("lib/groups/service.ts"),/group_settlement_cycle_adjustments adj/);
  assert.match(read("lib/settlement-cycles/settings.ts"),/SETTLEMENT_CYCLE_ENGINE_READY = false/);
});
