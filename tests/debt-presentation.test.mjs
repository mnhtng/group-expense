import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = path => readFileSync(path, "utf8");
const personal = source("app/(app)/debts/page.tsx");
const group = source("app/(app)/groups/[groupId]/debts/page.tsx");
const detail = source("app/(app)/groups/[groupId]/debts/[debtId]/page.tsx");
const card = source("components/debts/debt-card.tsx");
const service = source("lib/debts/service.ts");
const css = source("app/globals.css");
const settlementList = source("app/(app)/groups/[groupId]/settlements/page.tsx");

test("money direction has consistent semantic tokens, signs and neutral third-party behavior", () => {
  assert.match(css, /--color-money-in:\s*var\(--money-in\)/);
  assert.match(css, /--color-money-out:\s*var\(--money-out\)/);
  assert.match(personal, /text-money-out/);
  assert.match(personal, /text-money-in/);
  assert.match(card, /debt\.debtorId === viewerId/);
  assert.match(card, /debt\.creditorId === viewerId/);
  assert.match(card, /"text-foreground"/);
  assert.match(card, /"−"/);
  assert.match(card, /"\+"/);
  assert.match(settlementList, /x\.debtorId === user\.id/);
  assert.match(settlementList, /x\.creditorId === user\.id/);
});

test("every personal obligation links to its own debt breakdown", () => {
  assert.match(personal, /listPersonalDebtItems\(user\.id\)/);
  assert.match(personal, /<DebtCard key=\{debt\.id\}/);
  assert.match(card, /\/groups\/\$\{debt\.groupId\}\/debts\/\$\{debt\.id\}/);
  assert.match(card, /sourcePreview/);
  assert.match(card, /expenseTotalMinor/);
  assert.match(group, /<DebtCard key=\{debt\.id\}/);
  assert.match(service, /AND EXISTS \(SELECT 1 FROM group_members m/);
  assert.match(service, /o\.amount_minor > COALESCE/);
});

test("debt detail shows exact item sources and repayment allocations", () => {
  assert.match(service, /FROM obligation_sources WHERE obligation_id=\$1/);
  assert.match(service, /FROM settlement_allocations a/);
  assert.match(service, /WHERE a\.obligation_id=\$1 AND s\.group_id=\$2/);
  assert.match(detail, /sources\.map/);
  assert.match(detail, /payments\.map/);
  assert.match(detail, /status === "confirmed"/);
  assert.match(detail, /Chưa trừ khỏi công nợ/);
  assert.match(detail, /Có thể thanh toán/);
});
