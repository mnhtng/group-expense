import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=p=>readFileSync(p,"utf8");

test("BN-006 writes only to disposable CI PostgreSQL; no release flag or fake cash",()=>{
  const s=read("lib/settlement-cycles/residual-repayments.ts");
  const flag=read("lib/settlement-cycles/settings.ts");
  assert.match(s,/process\.env\.CI==="true"/);
  assert.match(s,/process\.env\.BN006_TEST_ONLY==="isolated-pg17"/);
  assert.match(s,/process\.env\.DATABASE_URL==="postgresql:\/\/test:test@localhost:5432\/group_expense"/);
  assert.match(s,/if\(!isResidualCashTestWritable\(\)\)/);
  assert.match(flag,/SETTLEMENT_CYCLE_ENGINE_READY = false/);
  assert.match(s,/VALUES\(\$1,\$2,\$3,\$4,\$5,'pending'/);
  assert.match(s,/notifySettlement\(client,sid,actorId,"settlement_requested"\)/);
  assert.doesNotMatch(s,/UPDATE obligations|UPDATE expenses|UPDATE\s+group_settlement_bilateral_applications|INSERT INTO group_settlement_bilateral_application_allocations/i);
  assert.doesNotMatch(s,/SETTLEMENT_CYCLE_ENGINE_READY\s*=\s*true/);
});
test("BN-006 ties exactly one cash direction to original applied source",()=>{
  const sql=read("db/migrations/020_bilateral_residual_cash_repayments.sql");
  assert.match(sql,/REFERENCES group_settlement_bilateral_applications\(id\)/);
  assert.match(sql,/REFERENCES group_settlement_cycle_repayments\(settlement_id\)/);
  assert.match(sql,/sum_forward<>NEW\.amount_minor OR sum_backward<>0/);
  assert.match(sql,/pending_existing<>NEW\.amount_minor/);
  assert.match(sql,/b\.outstanding_minor>0/);
  assert.match(sql,/bn006_residual_audit_immutable/);
  assert.match(sql,/FOR UPDATE/);
  assert.match(sql,/bn006_validate_residual/);
  const service=read("lib/settlement-cycles/residual-repayments.ts");
  assert.match(service,/BigInt\(r\.confirmedSetoffMinor\)/);
  assert.match(service,/original-cash-setoff!==outstanding/);
  assert.match(service,/pending>0n\|\|ambiguous/);
  assert.match(service,/available<0n/);
  assert.match(service,/ORDER BY o\.id/);
  assert.match(service,/FOR UPDATE OF o/);
  assert.match(service,/status:"pending" as const/);
});
test("BN-006 uses session identities, denies fake client amounts and no auto-confirm",()=>{
  const route=read("app/api/groups/[groupId]/settlement-cycle/cycles/[cycleId]/bilateral-applications/[applicationId]/residual/route.ts");
  assert.match(route,/getCurrentSession\(\)/);
  assert.match(route,/session\.user\.id/);
  assert.match(route,/expectedCycleVersion","requestKey","expectedFingerprint/);
  assert.doesNotMatch(route,/confirmSettlement|status:fields|actorId:fields|amountMinor:fields/);
  assert.match(read("lib/settlements/service.ts"),/isInitiator \|\| !\[row\.debtor_id,row\.creditor_id\]\.includes\(actorId\)/);
});
