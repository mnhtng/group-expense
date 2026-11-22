import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=path=>readFileSync(path,"utf8");
const lifecycle=read("lib/settlement-cycles/lifecycle.ts");
const sql=read("db/migrations/032_unlocked_cycle_amendments.sql");
const ui=read("components/groups/settlement-cycle-lifecycle-panel.tsx");
const detail=read("app/(app)/groups/[groupId]/cycles/[cycleId]/page.tsx");
const api=read("app/api/groups/[groupId]/settlement-cycle/cycles/[cycleId]/route.ts");

test("manual REVIEW and OPEN may edit under manager authorization and optimistic concurrency",()=>{
  assert.match(lifecycle,/withAuthorizedCycleManager\(groupId,actorId/);
  assert.match(lifecycle,/if\(!\["open","review"\]\.includes\(c\.state\)\)/);
  assert.match(lifecycle,/if\(c\.source!=="manual"\)/);
  assert.match(lifecycle,/c\.draftRevision!==input\.expectedDraftRevision/);
  assert.match(lifecycle,/await assertNoFinancialArtifacts\(client,cycleId\)/);
  assert.match(lifecycle,/old\.state==="review"&&Date\.parse\(endAt\)>Date\.now\(\)/);
  assert.match(lifecycle,/state IN\('open','review'\) AND source='manual'/);
  assert.match(sql,/OLD\.source='manual'/);
  assert.match(sql,/NEW\.end_at<=clock_timestamp\(\)/);
});
test("both manual and scheduled unlocked cycles cancel softly and chronologically",()=>{
  assert.match(lifecycle,/state IN\('open','review'\)\s+AND cancelled_at IS NULL/);
  assert.match(lifecycle,/source='scheduled' AND state='open'\s+AND cancelled_at IS NULL/);
  assert.match(lifecycle,/SELECT max\(end_at\) AS end_at[\s\S]*source='scheduled'/);
  assert.match(sql,/NEW\.cancelled_at IS NOT NULL/);
  assert.match(sql,/group_settlement_cycle_adjustments/);
  assert.match(sql,/group_settlement_cycle_snapshots/);
  assert.match(sql,/state IN \('open','review'\)/);
  assert.match(sql,/DROP CONSTRAINT sc026_cancelled_draft_consistent/);
  assert.match(lifecycle,/draftAudit\(client,updated\.rows\[0\],actorId,"period_cancelled",old\)/);
  assert.doesNotMatch(lifecycle,/DELETE FROM group_settlement_cycles/);
});
test("locked cycles remain immutable, no financial business data writes",()=>{
  assert.match(sql,/OLD\.state='review' AND NEW\.state='locked'/);
  assert.match(sql,/Invalid cycle state transition or incomplete financial snapshot/);
  assert.match(ui,/cycle\.state!=="locked"&&schedule\.canManage/);
  assert.match(ui,/cycle\.source==="manual"&&<button/);
  assert.match(ui,/key=\{cycle\.id\+"-"\+cycle\.draftRevision\}/);
  assert.match(detail,/selected\.source==="manual"\?"Sửa hoặc xóa kỳ":"Hủy kỳ chưa chốt"/);
  assert.match(api,/export const PATCH=/);
  assert.match(api,/export const DELETE=/);
  assert.doesNotMatch(sql,/\b(?:DELETE|UPDATE|TRUNCATE)\s+(?:FROM\s+)?(?:expenses|obligations|settlements|settlement_allocations)\b/i);
});
