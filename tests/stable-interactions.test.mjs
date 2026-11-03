import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

function sourceFiles(folder) {
  return readdirSync(folder,{withFileTypes:true}).flatMap(entry=>{
    const absolute=path.join(folder,entry.name);
    return entry.isDirectory()?sourceFiles(absolute):
      /\.(tsx|jsx)$/.test(entry.name)?[absolute]:[];
  });
}
test("application controls do not use auto-collapsing native disclosures",()=>{
  for(const file of [...sourceFiles("app"),...sourceFiles("components")]){
    const text=readFileSync(file,"utf8")
      .replace(/\/\*[\s\S]*?\*\//g,"")
      .replace(/^\s*\/\/.*$/gm,"");
    assert.doesNotMatch(text,/<\s*(?:details|summary)\b/i,
      "UI must not silently auto-collapse after refresh: "+file);
    assert.doesNotMatch(text,/\bwindow\.confirm\s*\(/,
      "Use a persistent inline confirmation, not a browser modal: "+file);
  }
});
test("group management uses stable client actions, not Server Action forms",()=>{
  const s=readFileSync("app/(app)/groups/[groupId]/manage/page.tsx","utf8");
  assert.match(s,/<GroupRenameForm/);
  assert.match(s,/<GroupArchiveForm/);
  assert.match(s,/<GroupInviteForm/);
  assert.doesNotMatch(s,/action=\{(?:renameGroupAction|archiveGroupAction)\}/);
});
test("notification polling merges newer rows instead of resetting paginated cards",()=>{
  const s=readFileSync("components/notifications/notification-inbox.tsx","utf8");
  assert.match(s,/mergeNotificationFeed\(previous,data\.notifications/);
  assert.match(s,/loadedOlder\.current/);
});
