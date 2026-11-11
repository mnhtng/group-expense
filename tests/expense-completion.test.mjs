import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = name => readFileSync(name, "utf8");

test("completion is creator-only in detail while the list stays a navigation surface",()=>{
  const list=read("app/(app)/groups/[groupId]/page.tsx");
  const detail=read("app/(app)/groups/[groupId]/expenses/[expenseId]/page.tsx");
  assert.doesNotMatch(list,/<CompleteExpenseButton/);
  assert.match(detail,/allSettled=remaining===0n&&pending===0n&&expense.invalidCount===0/);
  assert.match(detail,/!completed&&allSettled&&canEdit&&<CompleteExpenseButton/);
  assert.match(detail,/expenseId=\{expenseId\} version=\{expense.version\}/);
  assert.match(list,/invoices=completed/);
});

test("eligible invoices must rank before unsettled invoices in SQL, including above the 100-row limit",()=>{
  const service=read("lib/expenses/service.ts");
  assert.match(service,/progress\."remainingMinor"\)::numeric = 0/);
  assert.match(service,/progress\."pendingMinor"\)::numeric = 0/);
  assert.match(service,/e\.created_by=\$2 THEN 0/);
  assert.match(service,/THEN 1\s+ELSE 2/);
  assert.match(service,/ORDER BY[\s\S]+?CASE[\s\S]+?e\.occurred_on DESC, e\.created_at DESC LIMIT 100/);
});

test("completion requires original creator, confirmed zero outstanding, and immutable audit",()=>{
  const service=read("lib/expenses/service.ts");
  assert.match(service,/canModifyExpense\(invoice\.createdBy,actorId\)/);
  assert.match(service,/completionReady\(invoice\)/);
  assert.match(service,/INSERT INTO expense_completion_events/);
  assert.match(service,/FOR UPDATE OF e/);
  assert.match(service,/Hóa đơn đã hoàn thành, không thể sửa/);
  assert.match(service,/Hóa đơn đã hoàn thành, không thể xóa/);
  const route=read("app/api/groups/[groupId]/expenses/[expenseId]/complete/route.ts");
  assert.match(route,/getCurrentSession\(/);
  assert.match(route,/completeExpense\(/);
  const sql=read("db/migrations/009_expense_completion.sql");
  assert.match(sql,/completed_by = created_by/);
  assert.match(sql,/ADD COLUMN completed_at timestamptz/);
});

test("inline completion requires second deliberate click and optionally captures financial notes",()=>{
  const ui=read("components/expenses/complete-expense-button.tsx");
  assert.match(ui,/setConfirming\(true\)/);
  assert.match(ui,/<InlineConfirmation/);
  assert.match(ui,/note=\{note\} onNoteChange=\{setNote\}/);
  assert.match(ui,/expectedVersion:version,note/);
  assert.match(ui,/router\.refresh\(\)/);
});
