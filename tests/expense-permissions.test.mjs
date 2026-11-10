import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { canModifyExpense } from "../lib/expenses/permissions.ts";

const read = path => readFileSync(path, "utf8");

test("only the immutable expense creator can modify it; there is no role override", () => {
  const creator = "creator-1";
  const owner = "owner-2";
  const admin = "admin-3";
  const payer = "payer-4";
  assert.equal(canModifyExpense(creator, creator), true);
  for (const actor of [owner, admin, payer, "unrelated-member", "", "CREATOR-1"]) {
    assert.equal(canModifyExpense(creator, actor), false, actor);
  }
  assert.equal(canModifyExpense("", ""), false);
  assert.equal(canModifyExpense("", creator), false);
});

test("service enforces creator-only for PATCH and DELETE without owner/admin exceptions", () => {
  const source = read("lib/expenses/service.ts");
  assert.doesNotMatch(source, /function editable\s*\(/);
  assert.doesNotMatch(source, /role\s*===\s*["'](?:owner|admin)["']/);
  assert.equal((source.match(/if \(!canModifyExpense\(expense\.created_by, actorId\)\)/g) ?? []).length, 2);
  assert.match(source, /FOR UPDATE/);
  assert.match(source, /assertNoActiveSettlements\(client, expenseId\)/);
});

test("expense page and edit URL both enforce the same creator-only policy", () => {
  const detail = read("app/(app)/groups/[groupId]/expenses/[expenseId]/page.tsx");
  const edit = read("app/(app)/groups/[groupId]/expenses/[expenseId]/edit/page.tsx");
  assert.match(detail, /canEdit\s*=\s*canModifyExpense\(expense\.createdBy,\s*user\.id\)/);
  assert.match(edit, /if \(!canModifyExpense\(expense\.createdBy,\s*user\.id\)\) notFound\(\)/);
  for (const source of [detail, edit]) {
    assert.doesNotMatch(source, /role\s*===\s*["'](?:owner|admin)["']/);
    assert.doesNotMatch(source, /role\s*!==\s*["'](?:owner|admin)["']/);
  }
  assert.match(detail, /editable=canEdit&&!completed&&confirmed===0n&&pending===0n/);
  assert.match(detail, /editable&&<DeleteExpenseButton/);
});
