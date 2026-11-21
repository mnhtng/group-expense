/**
 * Operator/deployment preflight: run AFTER SQL migrations and reviewed runtime
 * GRANT provisioning, BEFORE allowing traffic to a new financial endpoint.
 *
 * Uses DATABASE_URL only (the app's real login), not DATABASE_URL_DIRECT.
 * Read-only. Never prints role names, hostnames, passwords or raw query errors.
 */
import pg from "pg";
import {resolveDatabaseUrl} from "./connection.mjs";
import {
  CASH_INTENT_RUNTIME_PRIVILEGES_SQL,
  evaluateCashIntentRuntimePrivileges,
  projectCashIntentRuntimePrivileges,
} from "./runtime-finance-policy.mjs";

const pool=new pg.Pool({
  connectionString:resolveDatabaseUrl("runtime"),
  max:1,connectionTimeoutMillis:10000,
});
try{
  const {rows}=await pool.query(CASH_INTENT_RUNTIME_PRIVILEGES_SQL);
  const result=evaluateCashIntentRuntimePrivileges(
    projectCashIntentRuntimePrivileges(rows[0]));
  if(!result.ok)throw Error("BN030_RUNTIME_ACL_MISMATCH: "+result.reasons.join(", "));
  // Check a real SELECT with the same non-owner login as the app.
  await pool.query("SELECT id FROM public.group_settlement_bilateral_cash_intents LIMIT 0");
  console.log("BN-030 runtime permissions: PASS (app login, read-only preflight)");
}catch(error){
  console.error("BN-030 runtime permissions: FAIL",
    error instanceof Error && error.message.startsWith("BN030_RUNTIME_ACL_MISMATCH")
      ?error.message:"DATABASE_READ_OR_ACCESS_FAILED");
  process.exitCode=1;
}finally{
  await pool.end();
}
