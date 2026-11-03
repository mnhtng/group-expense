import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { optionalNote } from "../lib/notes.ts";

const read = path => readFileSync(path,"utf8");

test("optional note accepts missing, empty and whitespace-only values",()=>{
  assert.equal(optionalNote(undefined),null);
  assert.equal(optionalNote(null),null);
  assert.equal(optionalNote(""),null);
  assert.equal(optionalNote("   "),null);
  assert.equal(optionalNote("  Mua giúp bạn  "), "Mua giúp bạn");
  assert.equal(optionalNote("test",500),"test");
});
test("note limits and types are enforced server-side",()=>{
  assert.throws(()=>optionalNote("x".repeat(1001)),/Ghi chú tối đa 1000/);
  assert.throws(()=>optionalNote("x".repeat(501),500),/Ghi chú tối đa 500/);
  assert.throws(()=>optionalNote({secret:"bad"}),/Ghi chú/);
});
test("every business form has an optional note input or explicit note-bearing confirmation",()=>{
  for(const name of [
    "components/groups/create-group-form.tsx",
    "components/groups/group-rename-form.tsx",
    "components/groups/group-invite-form.tsx",
    "components/groups/group-archive-form.tsx",
    "components/groups/accept-invite-form.tsx",
  ]) assert.match(read(name),/OptionalNoteField/,name);
  for(const name of [
    "components/groups/group-membership-manager.tsx",
    "components/settlements/settlement-actions.tsx",
    "components/expenses/delete-expense-button.tsx",
  ]) assert.match(read(name),/onNoteChange=/,name);
  for(const name of [
    "components/settlements/settlement-request-form.tsx",
    "components/settlements/batch-settlement-form.tsx",
    "components/expenses/expense-form.tsx",
  ]) assert.match(read(name),/Ghi chú \(không bắt buộc\)/,name);
});
test("notes persist through the corresponding server action or SQL event",()=>{
  for(const path of [
    "app/api/groups/route.ts",
    "app/api/groups/[groupId]/rename/route.ts",
    "app/api/groups/[groupId]/archive/route.ts",
    "app/api/groups/[groupId]/invites/route.ts",
    "app/api/invites/accept/route.ts",
  ]) assert.match(read(path),/optionalNote\(/,path);
  assert.match(read("lib/groups/service.ts"),/group_note_events/);
  assert.match(read("lib/groups/service.ts"),/group_invites\(id,group_id,token_hash,created_by,expires_at,notes\)/);
  assert.match(read("lib/groups/membership.ts"),/\{previousOwnerId:actorId,newOwnerId:targetId,note\}/);
  assert.match(read("lib/expenses/service.ts"),/previousVersion: expense.version, note/);
  assert.match(read("components/settlements/settlement-actions.tsx"),/JSON.stringify\(\{action,note\}\)/);
});
