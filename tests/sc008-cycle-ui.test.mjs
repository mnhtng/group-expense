import {assertDefaultEngineDisabled} from './helpers/engine-release-policy.mjs';
import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=(path)=>readFileSync(path,"utf8");

test("SC-008 has a member-visible mobile cycle list and contextual cycle detail",()=>{
  const group=read("app/(app)/groups/[groupId]/manage/page.tsx");
  const list=read("app/(app)/groups/[groupId]/cycles/page.tsx");
  const detail=read("app/(app)/groups/[groupId]/cycles/[cycleId]/page.tsx");
  assert.match(group,/href=\{base\+"\/cycles"\}/);
  assert.match(list,/requireUser\(\)/);
  assert.match(list,/getGroupDetails\(groupId,user\.id\)/);
  assert.match(list,/getSettlementSettings\(groupId,user\.id\)/);
  assert.match(list,/records\.cycles\.map/);
  assert.match(list,/min-h-24/);
  assert.match(list,/setting\.effectiveEnabled\?/);
  assert.match(list,/Quyết toán chưa mở cho nhóm/);
  assert.match(detail,/getGroupDetails\(groupId,user\.id\)/);
  assert.match(detail,/listMembers\(groupId,user\.id\)/);
  assert.match(detail,/getSettlementSettings\(groupId,user\.id\)/);
  assert.match(detail,/readCycleSources\(groupId,selected,user\.id,page\)/);
  assert.match(detail,/SettlementCycleSourceList/);
  assert.match(detail,/SettlementCycleFinancePanel/);
  assert.match(detail,/SettlementLateInvoicePanel/);
  assert.match(detail,/settings\.canManage/);
});

test("SC-008 every old cycle remains readable by direct authorized ID, history paginates",()=>{
  const life=read("lib/settlement-cycles/lifecycle.ts");
  const list=read("app/(app)/groups/[groupId]/cycles/page.tsx");
  const detail=read("app/(app)/groups/[groupId]/cycles/[cycleId]/page.tsx");
  assert.match(life,/export async function getSettlementCycleById/);
  assert.match(life,/export async function listSettlementCycleHistoryPage/);
  assert.ok(life.includes("getSettlementSettings(groupId,actorId)"));
  assert.ok(life.includes("LIMIT 50 OFFSET $2"));
  assert.match(list,/Phân trang lịch sử kỳ/);
  assert.ok(list.includes("records.totalPages"));
  assert.ok(detail.includes("getSettlementCycleById(groupId,cycleId,user.id)"));
  assert.ok(!detail.includes("listSettlementCycles(groupId,user.id,100)"));
  for(const page of [list,detail]){
    assert.ok(page.includes("getMemberRole(groupId,user.id)"));
    assert.ok(page.includes("if(!await getMemberRole(groupId,user.id))notFound()"));

  }
});

test("SC-008 source list derives totals from ORIGINAL unpaginated BN-005 source, never displayed page",()=>{
  const source=read("lib/settlement-cycles/ui-read.ts");
  const ui=read("components/groups/settlement-cycle-source-list.tsx");
  assert.match(source,/BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY/);
  assert.match(source,/m\.status='active'/);
  assert.match(source,/c\.state='locked'/);
  assert.match(source,/group_settlement_cycle_snapshot_obligations src/g);
  assert.match(source,/JOIN bn005_obligation_balances b/);
  assert.match(source,/sum\(b\.confirmed_cash_minor\)/);
  assert.match(source,/sum\(b\.confirmed_setoff_minor\)/);
  assert.match(source,/sum\(b\.pending_cash_minor\)/);
  assert.match(source,/LIMIT 50 OFFSET \$3/);
  assert.match(source,/originalMinor\)-BigInt\(totals\.cashMinor\)/);
  assert.match(ui,/source\.totals/);
  assert.match(ui,/source\.lines\.map/);
  assert.match(ui,/line\.obligationId/);
  assert.match(ui,/\/expenses\/\$\{line\.expenseId\}/);
  assert.match(ui,/Tiền đã xác nhận/);
  assert.match(ui,/Đã bù nợ/);
  assert.match(ui,/Chờ xác nhận/);
  assert.match(ui,/Nhập muộn/);
  assert.match(ui,/aria-label="Phân trang nguồn công nợ"/);
  assert.doesNotMatch(ui,/source\.lines\.reduce|Number\(line\.outstandingMinor\)/);
});

test("SC-008 never enables money through frontend opt-in, and requires real pairwise consent",()=>{
  const view=read("components/groups/settlement-cycle-finance-panel.tsx");
  assertDefaultEngineDisabled();
  assert.match(view,/const financeReady=financialEngineEnabled&&requestedEnabled/);
  assert.match(view,/bilateralEnabled&&counterparts\.length>0/);
  assert.match(view,/key=\{other\}/);
  assert.match(view,/decision\.approvedBy\.length/);
  assert.match(view,/decision\.canApprove/);
  assert.match(view,/decision\.canReject/);
  assert.match(view,/decision\.canRevoke/);
  assert.match(view,/!checked\|\|busy/);
  assert.match(view,/disabled=\{!canUse\}/);
  assert.match(view,/crypto\.randomUUID\(\)/);
  assert.match(view,/response\.status===409|e\.status===409/);
  assert.match(view,/Đã bù nợ/);
  assert.match(view,/Yêu cầu trả phần còn lại/);
  assert.match(view,/Tiền đang chờ/);
  assert.doesNotMatch(view,/<details|<summary|window\.confirm\(/i);
  assert.doesNotMatch(view,/financialEngineEnabled\s*=\s*true/);
});

test("SC-008 audits original late source without duplicating debt, only authorized manager may assign",()=>{
  const late=read("components/groups/settlement-late-invoice-panel.tsx");
  const service=read("lib/settlement-cycles/adjustments.ts");
  assert.match(late,/data\.canManage&&canManage/);
  assert.match(late,/selected\.expenseVersion/);
  assert.match(late,/expectedExpenseVersion/);
  assert.match(late,/requestKey:keyRef\.current/);
  assert.match(late,/original|hóa đơn gốc|Nhập muộn/i);
  assert.match(late,/!accepted\|\|busy/);
  assert.match(service,/withAuthorizedCycleManager\(groupId,actorId/);
  assert.doesNotMatch(late,/amountMinor:|status:"confirmed"/);
});
