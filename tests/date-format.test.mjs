import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  formatDateDMY, formatDateTimeDMY, parseDateDMY, todayVietnamISO,
} from "../lib/date-format.ts";

test("date-only values are always shown as d/m/yyyy, regardless of timezone", () => {
  assert.equal(formatDateDMY("2026-11-04"), "4/11/2026");
  assert.equal(formatDateDMY("2024-02-29"), "29/2/2024");
  assert.equal(formatDateDMY("2026-01-01"), "1/1/2026");
  assert.equal(formatDateDMY("2026-02-29"), "—");
  assert.equal(formatDateDMY("2026-04-31"), "—");
  assert.equal(formatDateDMY("invalid"), "—");
});

test("date input accepts valid d/m/yyyy with or without padded numbers", () => {
  assert.equal(parseDateDMY("4/11/2026"), "2026-11-04");
  assert.equal(parseDateDMY("04/11/2026"), "2026-11-04");
  assert.equal(parseDateDMY(" 29/2/2024 "), "2024-02-29");
  assert.equal(parseDateDMY("1/1/2026"), "2026-01-01");
  for (const invalid of ["", "2/30/2026", "30/2/2026", "29/2/2026",
    "31/4/2026", "0/1/2026", "1/13/2026", "2026-11-04",
    "11/04/26", "13/13/2026", "4/11/999"]) {
    assert.equal(parseDateDMY(invalid), null, invalid);
  }
});

test("timestamp uses fixed Vietnam timezone and d/m/yyyy HH:mm", () => {
  assert.equal(formatDateTimeDMY("2026-11-03T18:30:00.000Z"), "4/11/2026 01:30");
  assert.equal(formatDateTimeDMY("2026-01-01T00:05:00.000Z"), "1/1/2026 07:05");
  assert.equal(formatDateTimeDMY("invalid"), "—");
  assert.match(todayVietnamISO(), /^\d{4}-\d{2}-\d{2}$/);
});

test("all user-facing financial and notification dates use common formatter", () => {
  const paths = [
    "app/(app)/groups/[groupId]/page.tsx",
    "app/(app)/groups/[groupId]/expenses/[expenseId]/page.tsx",
    "components/debts/debt-card.tsx",
    "app/(app)/groups/[groupId]/debts/[debtId]/page.tsx",
    "app/(app)/groups/[groupId]/settlements/page.tsx",
    "app/(app)/groups/[groupId]/settlements/[settlementId]/page.tsx",
    "components/notifications/notification-inbox.tsx",
  ];
  for (const path of paths) {
    const source = readFileSync(path, "utf8");
    assert.match(source, /formatDate(?:Time)?DMY\(/, path);
    assert.doesNotMatch(source, /\.toLocaleString\("vi-VN"\)/, path);
    assert.doesNotMatch(source, /const shortDate =/, path);
  }
  const expense = readFileSync("components/expenses/expense-form.tsx", "utf8");
  assert.match(expense, /<DateDMYInput value=\{occurredOn\}/);
  assert.match(expense, /todayVietnamISO\(\)/);
  assert.match(expense, /if \(!occurredOn\)/);
  const input = readFileSync("components/ui/date-dmy-input.tsx","utf8");
  assert.match(input,/placeholder="d\/m\/yyyy"/);
  assert.match(input,/parseDateDMY\(raw\) \?\? ""/);
  assert.match(input,/type="date"/);
});
