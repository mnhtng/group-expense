import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {normalizeInviteUrl} from "../lib/invites/invite-link.ts";
const token="abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG";
test("invite URLs use the active staging or production origin",()=>{
  const origin="https://group-expense-git-develop.example.com";
  assert.equal(normalizeInviteUrl(`https://old.example.com/invite/${token}`,origin),
    `${origin}/invite/${token}`);
  assert.equal(normalizeInviteUrl(`/invite/${token}`,origin),`${origin}/invite/${token}`);
});
test("rejects invalid QR invite paths and unsupported URL schemes",()=>{
  for(const input of ["/admin","/invite/invalid",`/invite/${token}/extra`])
    assert.equal(normalizeInviteUrl(input,"https://example.com"),null);
  assert.equal(normalizeInviteUrl(`/invite/${token}`,"javascript:alert(1)"),null);
});
test("QR is local, exports PNG and supports native image sharing",()=>{
  const source=readFileSync("components/groups/invite-qr.tsx","utf8");
  assert.match(source,/import\("qrcode-generator"\)/);
  assert.match(source,/canvas\.toBlob/);
  assert.match(source,/navigator\.canShare/);
  assert.match(source,/navigator\.share/);
  assert.match(source,/URL\.createObjectURL/);
  assert.doesNotMatch(source,/api\.qrserver|quickchart\.io|qr-code-api/i);
});
test("invite QR section does not render literal escaped newline",()=>{
  const source=readFileSync("components/groups/group-invite-form.tsx","utf8");
  assert.match(source,/<InviteQr\b/);
  assert.doesNotMatch(source,/>\\n\s*<InviteQr\b/);
});
