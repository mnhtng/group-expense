import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=(path)=>readFileSync(path,"utf8");
const exactUrl="postgresql://test:test@localhost:5432/group_expense";

test("SC-007 release gate: backend financial engine stays OFF, never env-toggleable",()=>{
  const cfg=read("lib/settlement-cycles/settings.ts");
  assert.match(cfg,/SETTLEMENT_CYCLE_ENGINE_READY\s*=\s*false\s+as\s+boolean/);
  assert.doesNotMatch(cfg,/SETTLEMENT_CYCLE_ENGINE_READY\s*=\s*process\.env/);
  const workflow=read(".github/workflows/sprint1-integration.yml");
  assert.match(workflow,/postgres:\s*\n\s*image:\s*postgres:17/);
  assert.match(workflow,/SC007_TEST_ONLY: isolated-pg17/);
  assert.match(workflow,/BN004_TEST_ONLY: isolated-pg17/);
  assert.match(workflow,/BN006_TEST_ONLY: isolated-pg17/);
  assert.match(workflow,/SC005_TEST_ONLY: isolated-pg17/);
  assert.match(workflow,/test:finance:audit/g);
  assert.ok(workflow.indexOf("run: pnpm test:finance:audit")<
    workflow.indexOf("run: pnpm test:http"));
  assert.ok(workflow.lastIndexOf("run: pnpm test:finance:audit")>
    workflow.indexOf("run: pnpm test:http"));
  assert.doesNotMatch(workflow,/neon\.tech|vercel deploy|git push.*main/);
});

test("SC-007 release gate: all scoped financial writers require CI, isolated PG and exact URL",()=>{
  const cases=[
    ["lib/settlement-cycles/repayments.ts","SC005_TEST_ONLY"],
    ["lib/settlement-cycles/applications.ts","BN004_TEST_ONLY"],
    ["lib/settlement-cycles/residual-repayments.ts","BN006_TEST_ONLY"],
  ];
  for(const [path,flag] of cases){
    const s=read(path);
    assert.match(s,/process\.env\.CI\s*===\s*["']true["']/);
    assert.ok(s.includes(`process.env.${flag}`),path);
    assert.ok(s.includes(exactUrl),path);
    assert.doesNotMatch(s,/SETTLEMENT_CYCLE_ENGINE_READY\s*=\s*true/);
  }
  const audit=read("db/sc007-audit.mjs");
  assert.match(audit,/READ ONLY/);
  assert.ok(audit.includes(exactUrl));
  assert.ok(audit.includes('process.env.SC007_TEST_ONLY!=="isolated-pg17"'));
  assert.doesNotMatch(audit,/\b(?:INSERT|UPDATE|DELETE|DROP|TRUNCATE)\s+(?:INTO\s+|FROM\s+)?(?:obligations|settlements|expenses|group_settlement)/i,
    "auditor must never write any financial source or table");
});

test("SC-007 release gate: two-person authorization, cash consent and manager scope stay independent",()=>{
  const app=read("lib/settlement-cycles/applications.ts");
  const residual=read("lib/settlement-cycles/residual-repayments.ts");
  const cash=read("lib/settlements/service.ts");
  const late=read("lib/settlement-cycles/adjustments.ts");
  const routes=[
    "app/api/groups/[groupId]/settlement-cycle/cycles/[cycleId]/bilateral-applications/[applicationId]/residual/route.ts",
    "app/api/groups/[groupId]/settlement-cycle/cycles/[cycleId]/late-adjustments/route.ts",
  ];
  for(const route of routes){
    const r=read(route);
    assert.match(r,/getCurrentSession\(\)/);
    assert.match(r,/session\.user\.id/);
  }
  assert.match(app,/actorId!==p\.partyLow&&actorId!==p\.partyHigh|actorId!==p\.low&&actorId!==p\.high|party_low/);
  assert.match(residual,/actorId!==a\.low&&actorId!==a\.high/);
  assert.match(residual,/status:"pending" as const/);
  assert.match(residual,/pending>0n\|\|ambiguous/);
  assert.match(late,/withAuthorizedCycleManager\(groupId,actorId/);
  assert.match(cash,/isInitiator/);
  assert.doesNotMatch(residual,/status:["']confirmed["']/);
});

test("SC-007 late-source SQL proof is derived from immutable SC-006 audit, not caller booleans",()=>{
  const proposals=read("lib/settlement-cycles/proposals.ts");
  assert.match(proposals,/group_settlement_cycle_adjustments adj/);
  assert.match(proposals,/adj\.target_cycle_id=src\.cycle_id/);
  assert.match(proposals,/adj\.expense_version=src\.expense_version/);
  assert.match(proposals,/lateAttributionVerified:r\.auditedLateAttribution/);
  const model=read("lib/settlement-cycles/bilateral-calculator.ts");
  assert.match(model,/raw\.lateAttributionVerified !== true/);
  assert.match(model,/raw\.inLockedCycleSnapshot !== true/);
  const docs=read("docs/settlement-cycles/SC-006-LIFECYCLE-ADJUSTMENTS.md");
  assert.match(docs,/original/i);
});
