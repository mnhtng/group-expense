import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {RR001_TARGET} from "../db/rr001-neon-preflight.mjs";
import {RR003_TARGET} from "../db/rr003-recovery-policy.mjs";
import {BASELINE_FORMAT,CHECK_NAMES,FINANCIAL_CLASSES,compareDigests,
  verifyCompareEnvironment,verifyCompareUrl}
  from "../db/rr003-restore-compare.mjs";
const targetHost="ep-rr003-demo.c-4.ap-southeast-1.aws.neon.tech";
const url=host=>"postgresql://fake_role:fake_password@"+host+
  "/group_expense?sslmode=require";
const env=()=>({
  RR003_PROJECT_ID:RR003_TARGET.project,
  RR003_SOURCE_BRANCH_ID:RR003_TARGET.sourceBranch,
  RR003_SOURCE_DATABASE_URL:url(RR001_TARGET.directHost),
  RR003_TARGET_BRANCH_ID:"br-rr003-demo-recovery",
  RR003_TARGET_PARENT_BRANCH_ID:RR003_TARGET.sourceBranch,
  RR003_TARGET_HOST:targetHost,
  RR003_RESTORE_DATABASE_URL:url(targetHost),
  RR003_RESTORE_POINT_UTC:"2026-11-07T10:00:00Z",
  RR003_REVIEWED_AT_UTC:"2026-11-07T10:30:00Z",
  RR003_HISTORY_RETENTION_SECONDS:"21600",
});
test("RR-003 capture only accepts isolated RR-001 child direct host",()=>{
  const x=verifyCompareEnvironment(env(),"capture");
  assert.equal(x.source,env().RR003_SOURCE_DATABASE_URL);
  assert.throws(()=>verifyCompareEnvironment({...env(),
    RR003_SOURCE_BRANCH_ID:"br-round-salad-b39y4yce"},"capture"),/source branch mismatch/);
  assert.throws(()=>verifyCompareEnvironment({...env(),
    RR003_SOURCE_DATABASE_URL:url(targetHost)},"capture"),
    /source\/target branch and TLS guards/);
});
test("RR-003 reject restored target if source, dev, production or non-Neon hostname",()=>{
  const x=verifyCompareEnvironment(env(),"verify");
  assert.equal(x.targetBranchId,env().RR003_TARGET_BRANCH_ID);
  assert.throws(()=>verifyCompareEnvironment({...env(),
    RR003_TARGET_BRANCH_ID:"br-dry-poetry-b31cudmb"},"verify"),
    /NEW independent isolated branch/);
  assert.throws(()=>verifyCompareEnvironment({...env(),
    RR003_TARGET_PARENT_BRANCH_ID:"br-round-salad-b39y4yce"},"verify"),
    /descend from isolated source/);
  assert.throws(()=>verifyCompareEnvironment({...env(),
    RR003_TARGET_HOST:RR001_TARGET.directHost,
    RR003_RESTORE_DATABASE_URL:env().RR003_SOURCE_DATABASE_URL},"verify"),
    /distinct/);
  assert.throws(()=>verifyCompareUrl(url("evil.example.test"),
    "evil.example.test"),/hostname required/);
  assert.throws(()=>verifyCompareUrl(url(targetHost).replace("sslmode=require","sslmode=disable"),
    targetHost),/TLS guards/);
  assert.throws(()=>verifyCompareUrl(url(targetHost)+"#x",targetHost),/TLS guards/);
  assert.throws(()=>verifyCompareUrl(url(targetHost)+"&options=unsafe",targetHost),/TLS guards/);
  assert.equal(verifyCompareUrl(url(targetHost)+"&channel_binding=require",targetHost),
    url(targetHost)+"&channel_binding=require");
  assert.throws(()=>verifyCompareUrl(url(targetHost)+"&channel_binding=disable",targetHost),
    /TLS guards/);
  const pooled="ep-rr003-demo-pooler.c-4.ap-southeast-1.aws.neon.tech";
  assert.throws(()=>verifyCompareUrl(url(pooled),pooled),/TLS guards/);
});
const baseline=()=>({
  format:BASELINE_FORMAT,
  projectId:RR003_TARGET.project,branchId:RR003_TARGET.sourceBranch,
  checks:Object.fromEntries(CHECK_NAMES.map((name,i)=>[
    name,{rows:i,sha256:String(i%10).repeat(64)}])),
});
test("RR-003 complete immutable financial comparison passes only exact matches",()=>{
  const a=baseline(),b=structuredClone(a);
  b.branchId="br-rr003-demo-recovery";
  assert.equal(FINANCIAL_CLASSES.length,52);
  assert.deepEqual(compareDigests(a,b),
    {checks:58,matched:true,releaseApproved:false});
  b.checks.noncash_allocations.sha256="a".repeat(64);
  assert.throws(()=>compareDigests(a,b),
    /immutable conservation mismatch: noncash_allocations/);
});
test("RR-003 refuses missing classes, changed project and leaked source ids",()=>{
  const a=baseline(),b=structuredClone(a);
  b.branchId="br-rr003-demo-recovery";
  delete b.checks.cash_settlements;
  assert.throws(()=>compareDigests(a,b),/incomplete conservation check classes/);
  b.checks.cash_settlements=a.checks.cash_settlements;
  b.projectId="other";
  assert.throws(()=>compareDigests(a,b),/project\/source branch mismatch/);
  a.branchId="br-round-salad-b39y4yce";
  assert.throws(()=>compareDigests(a,b),/project\/source branch mismatch/);
});
test("RR-003 comparator has read-only transactions, bounded whitelisted scans, no finance writes",()=>{
  const source=readFileSync("db/rr003-restore-compare.mjs","utf8");
  assert.match(source,/REPEATABLE READ READ ONLY/);
  assert.match(source,/SET LOCAL statement_timeout/);
  assert.match(source,/MAX_ROWS_PER_CLASS=10000/);
  assert.doesNotMatch(source,/client\.query\(["'](?:INSERT|UPDATE|DELETE|ALTER|CREATE|DROP)\s/i);
  assert.match(source,/flag:"wx",mode:0o600/);
  assert.match(source,/releaseApproved:false/);
  assert.match(readFileSync(".gitignore","utf8"),/\/rr003-artifacts\//);
  assert.match(readFileSync("lib/settlement-cycles/settings.ts","utf8"),
    /SETTLEMENT_CYCLE_ENGINE_READY = false/);
});

test("RR-003 refuses comparing source to itself, shared branches or obsolete partial manifests",()=>{
  const a=baseline(),b=structuredClone(a);
  for(const branchId of [a.branchId,...RR003_TARGET.excludedBranches,"invalid"]){
    b.branchId=branchId;
    assert.throws(()=>compareDigests(a,b),/independent isolated branch/);
  }
  b.branchId="br-rr003-demo-recovery";
  a.format="rr003-financial-baseline-v1";
  assert.throws(()=>compareDigests(a,b),/unsupported financial baseline format/);
});

test('RR-003 provider digest import rejects truncated classes, wrong branches and failed inventory',async()=>{
  const {validateProviderDigests,buildProviderDigestSql}=await import('../db/rr003-restore-compare.mjs');
  const manifest={...baseline(),capturedAt:'2026-11-09T12:00:00.000Z'};
  const row={manifest,inventoryMatches:true,database:'group_expense',pgMajor:17};
  assert.equal(validateProviderDigests(row,RR003_TARGET.sourceBranch),manifest);
  assert.throws(()=>validateProviderDigests({...row,inventoryMatches:false},RR003_TARGET.sourceBranch));
  assert.throws(()=>validateProviderDigests(row,'br-wrong'));
  manifest.checks.users.rows=10001;
  assert.throws(()=>validateProviderDigests(row,RR003_TARGET.sourceBranch),/truncated provider digest/);
  assert.throws(()=>buildProviderDigestSql("br-unsafe';DROP TABLE groups;--"));
});
