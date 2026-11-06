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
test("RR-002 stale fingerprint checks actual HTTP 409 and awaits UI invalidation",()=>{
  const s=read("tests/rr002-browser.e2e.mjs");
  assert.match(s,/waitForResponse\((?:response|r)=>/);
  assert.match(s,/staleResponse\.status\(\),409/);
  assert.match(s,/waitFor\(\{state:"hidden",timeout:10000\}\)/);
  assert.match(s,/hasText:\/Số liệu hóa đơn hoặc thanh toán đã thay đổi\//);
  assert.match(s,/a stale preview must also revoke the consent checkbox/);
  assert.match(s,/nativeClicks=/);
  assert.match(s,/crypto\.randomUUID=/);
  assert.match(s,/owner\.page\.on\("pageerror",recordPageError\)/);
  assert.match(s,/owner\.page\.off\("pageerror",recordPageError\)/);
  assert.doesNotMatch(s,/getByRole\("alert"\)\.first\(\)\.waitFor\(\);\s*assert\.equal\(await owner\.page\.getByText/);
});

test("RR-002 awaits real browser dispute writes before checking privacy",()=>{
  const s=read("tests/rr002-browser.e2e.mjs");
  assert.match(s,/async function observeBrowserPost\(/);
  assert.match(s,/await observeBrowserPost\(owner\.page,disputesPath/);
  assert.match(s,/opened\.status\(\),201/);
  assert.match(s,/opening\?\.dispute\?\.id/);
  assert.match(s,/await observeBrowserPost\(other\.page,eventsPath/);
  assert.match(s,/await observeBrowserPost\(owner\.page,eventsPath/);
  assert.match(s,/dispatched="\+/);
  assert.doesNotMatch(s,/await createDisputeButton\.click\(\);\s*await owner\.page\.getByText\(reason\)/);
});

test("RR-002 WebKit counterparty picker has a non-CSS-dependent 48px target",()=>{
  const s=read("components/groups/settlement-cycle-finance-panel.tsx");
  assert.match(s,/id="cycle-pair-member"/);
  assert.match(s,/style=\{\{height:"48px",minHeight:"48px"\}\}/);
  assert.match(s,/className="h-12 min-h-12 w-full/);
});

test("RR-002 focused profile never weakens the default four-browser matrix",()=>{
  const s=read("tests/rr002-browser.e2e.mjs");
  for(const name of ["chromium-desktop","webkit-desktop","iphone-simulator",
      "android-phone-simulator"])assert.ok(s.includes(name));
  assert.match(s,/const selected=process\.env\.RR002_PROFILE\?\.trim\(\)\?\?""/);
  assert.match(s,/if\(selected&&project!==selected\)continue/);
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

test("RR-002 expensive browser CI is opt-in on PR label, never every commit",()=>{
  const y=read(".github/workflows/rr002-browser-e2e.yml");
  assert.match(y,/pull_request:\s*\n\s+types: \[labeled\]/);
  assert.match(y,/github\.event\.label\.name == 'run-rr002-e2e'/);
  assert.doesNotMatch(y,/pull_request:\s*\n\s+paths:/);
});

test("RR-002 local runner uses a disposable loopback-only Docker database",()=>{
  const s=read("scripts/rr002-local.sh");
  assert.match(s,/set -euo pipefail/);
  assert.match(s,/postgres:17/);
  assert.match(s,/-p 127\.0\.0\.1:5432:5432/);
  assert.match(s,/docker rm -f/);
  assert.match(s,/trap cleanup EXIT/);
  assert.match(s,/pnpm db:migrate/);
  assert.match(s,/RR002_TEST_ONLY='isolated-pg17'/);
  assert.match(s,/node --test --test-reporter=spec tests\/rr002-browser\.e2e\.mjs/);
  assert.doesNotMatch(s,/SETTLEMENT_CYCLE_ENGINE_READY=true|neon\.tech|vercel deploy/);
});
