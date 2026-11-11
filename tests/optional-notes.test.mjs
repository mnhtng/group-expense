import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { optionalNote } from "../lib/notes.ts";

const read = path => readFileSync(path, "utf8");

test("optional financial notes trim whitespace and do not require a value", () => {
  assert.equal(optionalNote(undefined), null);
  assert.equal(optionalNote(null), null);
  assert.equal(optionalNote(""), null);
  assert.equal(optionalNote("   "), null);
  assert.equal(optionalNote("  Tiền ăn tối  "), "Tiền ăn tối");
});
test("server validates note types and financial limits", () => {
  assert.throws(() => optionalNote("x".repeat(1001)), /Ghi chú tối đa 1000/);
  assert.throws(() => optionalNote("x".repeat(501), 500), /Ghi chú tối đa 500/);
  assert.throws(() => optionalNote({ arbitrary: "value" }), /Ghi chú/);
});
test("all supported invoice and payment forms provide an optional note", () => {
  for (const path of [
    "components/expenses/expense-form.tsx",
    "components/settlements/settlement-request-form.tsx",
    "components/settlements/batch-settlement-form.tsx",
  ]) {
    assert.match(read(path), /Ghi chú \(không bắt buộc\)|OptionalNoteField/, path);
  }
  for (const path of [
    "components/expenses/delete-expense-button.tsx",
    "components/settlements/settlement-actions.tsx",
  ]) {
    assert.match(read(path), /onNoteChange=/, path);
    assert.match(read(path), /note=\{note\}/, path);
  }
  assert.match(read("components/ui/inline-confirmation.tsx"), /onNoteChange/);
});
test("no group, invite or membership form displays an optional note", () => {
  for (const path of [
    "components/groups/create-group-form.tsx",
    "components/groups/group-rename-form.tsx",
    "components/groups/group-archive-form.tsx",
    "components/groups/group-invite-form.tsx",
    "components/groups/accept-invite-form.tsx",
    "components/groups/group-membership-manager.tsx",
  ]) {
    assert.doesNotMatch(read(path), /OptionalNoteField|onNoteChange|setNote\(|name=["']note["']/, path);
  }
});
test("non-financial routes and services do not accept or expose notes", () => {
  for (const path of [
    "lib/groups/service.ts",
    "lib/groups/membership.ts",
    "app/api/groups/route.ts",
    "app/api/groups/[groupId]/rename/route.ts",
    "app/api/groups/[groupId]/archive/route.ts",
    "app/api/groups/[groupId]/invites/route.ts",
    "app/api/invites/accept/route.ts",
    "app/api/groups/[groupId]/membership/leave/route.ts",
    "app/api/groups/[groupId]/membership/transfer/route.ts",
    "app/api/groups/[groupId]/membership/members/[memberId]/route.ts",
  ]) {
    assert.doesNotMatch(read(path), /optionalNote\(|group_note_events|inviteNote|rawNote/, path);
  }
  assert.doesNotMatch(read("app/(app)/groups/[groupId]/page.tsx"), /group\.notes/);
  assert.doesNotMatch(read("app/invite/[token]/page.tsx"), /inviteNote/);
});
test("financial notes remain persisted in expense and settlement events", () => {
  assert.match(read("lib/expenses/service.ts"), /previousVersion: expense.version, note/);
  assert.match(read("app/api/groups/[groupId]/expenses/[expenseId]/route.ts"), /optionalNote\(body\?\.note\)/);
  assert.match(read("components/settlements/settlement-actions.tsx"), /JSON.stringify\(\{action,note\}\)/);
  assert.match(read("lib/settlements/service.ts"), /settlement_events/);
});
