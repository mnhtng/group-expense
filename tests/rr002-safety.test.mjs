import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const read=path=>readFileSync(path,"utf8");

test("RR-002 browser suite fails closed before connecting to any shared database",()=>{
  const s=read("tests/rr002-browser.e2e.mjs");
  assert.match(s,/RR002_TEST_ONLY/);
  assert.match(s,/postgresql:\/\/test:test@localhost:5432\/group_expense/);
  assert.match(s,/guard\(\);/);
  assert.ok(s.indexOf("guard();")<s.indexOf("new pg.Pool"),
    "fail-closed guard must execute before obtaining a DB client");
  assert.match(s,/BN004_TEST_ONLY/);
  assert.match(s,/BN006_TEST_ONLY/);
  assert.match(s,/SC005_TEST_ONLY/);
  assert.match(s,/SC009_TEST_ONLY/);
  assert.match(s,/SC007_TEST_ONLY/);
  assert.doesNotMatch(s,/\b(?:drop table|truncate table|delete from obligations)\b/i);
});
test("RR-002 runs actual browser interactions, not static source contract tests",()=>{
  const s=read("tests/rr002-browser.e2e.mjs");
  for(const text of ["playwright.chromium","playwright.webkit",
    'devices["iPhone 13"]','devices["Pixel 7"]',
    'getByRole("button"','getByLabel("Xem công nợ của tôi với")',
    'getByRole("checkbox"','browser.newContext','context.request',
    'page.screenshot','waitForURL','page.reload','page.route',
    'assertTapTarget','noHorizontalOverflow']){
    assert.ok(s.includes(text),"missing browser interaction: "+text);
  }
  assert.match(s,/stale fingerprint/i);
  assert.match(s,/dispute/i);
  assert.match(s,/RR002 synthetic/);
});
test("RR-002 reuses four real signed actors across browser profiles without disabling rate limits",()=>{
  const s=read("tests/rr002-browser.e2e.mjs");
  assert.match(s,/for\(const tag of \["owner","counterparty","admin","outsider"\]\)/);
  assert.match(s,/storageState:await u\.context\.storageState\(\)/);
  assert.match(s,/storageState:actor\.storageState/);
  assert.equal((s.match(/await userFor\(/g)||[]).length,1,
    "one signed setup per actor, never 16 bulk signups from one CI IP");
  assert.match(s,/response\.status\(\)!==429/);
  assert.match(s,/\["retry-after"\]/);
  assert.match(s,/await capture\(user\.page,project,"failure-actor-"/);
  assert.doesNotMatch(s,/rateLimit:\s*\{\s*enabled:\s*false/);
});
test("RR-002 CI never points to Neon or enables financial engine",()=>{
  const y=read(".github/workflows/rr002-browser-e2e.yml");
  assert.match(y,/postgres:17/);
  assert.match(y,/pnpm install --frozen-lockfile/);
  assert.match(y,/playwright@1\.64\.1/);
  assert.match(y,/playwright install --with-deps chromium webkit/);
  assert.match(y,/node --test --test-reporter=spec tests\/rr002-browser\.e2e\.mjs/);
  assert.match(y,/RR002_TEST_ONLY: isolated-pg17/);
  assert.doesNotMatch(y,/vercel deploy|DATABASE_URL_DIRECT|neon\.tech|git push|SETTLEMENT_CYCLE_ENGINE_READY=true/i);
  assert.match(read("lib/settlement-cycles/settings.ts"),
    /SETTLEMENT_CYCLE_ENGINE_READY = false/);
});
test("RR-002 invoice source touch target is at least 44px",()=>{
  const s=read("components/groups/settlement-cycle-source-list.tsx");
  assert.match(s,/inline-flex min-h-11 items-center break-words/);
});
