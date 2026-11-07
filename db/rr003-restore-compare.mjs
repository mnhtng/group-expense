/**
 * RR-003 future Neon restore drill: READ-ONLY, source -> immutable manifest
 * then independently restored branch -> compare. Does NOT create a branch,
 * request PITR, write SQL, replay cash, or contact production/development.
 *
 * CLI deliberately requires an operator-provided RESTORED branch ID/host,
 * verified against provider API first. Never run SC-010 restore script on Neon.
 */
import pg from "pg";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync,writeFileSync,mkdirSync} from "node:fs";
import {dirname,resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {RR003_TARGET,assertRestoreBranchPlan}
  from "./rr003-recovery-policy.mjs";
import {RR001_TARGET} from "./rr001-neon-preflight.mjs";

const MAX_ROWS_PER_CLASS=10000;
export const FINANCIAL_CLASSES=Object.freeze([
  ["schema_versions","schema_migrations","filename"],
  ["original_expenses","expenses","id"],
  ["original_obligations","obligations","id"],
  ["cash_settlements","settlements","id"],
  ["cash_allocations","settlement_allocations","settlement_id,obligation_id"],
  ["noncash_applications","group_settlement_bilateral_applications","id"],
  ["noncash_allocations","group_settlement_bilateral_application_allocations","application_id,obligation_id"],
  ["snapshot_sources","group_settlement_cycle_snapshot_obligations","cycle_id,obligation_id"],
  ["late_adjustments","group_settlement_cycle_adjustments","id"],
  ["dispute_documents","group_settlement_cycle_disputes","id"],
  ["dispute_history","group_settlement_cycle_dispute_events","id"],
  ["notifications","notifications","id"],
  ["cron_runs","settlement_cycle_operational_runs","id"],
  ["recurring_scan","recurring_cron_checkpoints","rule_id"],
  ["live_balances","bn005_obligation_balances","obligation_id"],
]);
const refuse=message=>{throw Error("RR-003 comparison refused: "+message);};

export function verifyCompareUrl(raw,requiredHost){
  if(typeof raw!=="string"||!raw||typeof requiredHost!=="string"||
    !/^ep-[a-z0-9-]+\.c-\d+\.[a-z0-9-]+\.aws\.neon\.tech$/.test(requiredHost))
    refuse("pinned Neon compute hostname required");
  let u;
  try{u=new URL(raw);}catch{refuse("malformed database URL");}
  if(!["postgres:","postgresql:"].includes(u.protocol)||u.hostname!==requiredHost||
    u.pathname!=="/"+RR003_TARGET.database||
    u.hash||(u.port&&u.port!=="5432")||
    !u.username||!u.password||
    requiredHost.includes("-pooler.")||
    u.searchParams.size!==1||
    !["require","verify-full","verify-ca"].includes(u.searchParams.get("sslmode")))
    refuse("database URL fails source/target branch and TLS guards");
  return raw;
}
export function verifyCompareEnvironment(env=process.env,mode="capture"){
  if(env.RR003_PROJECT_ID!==RR003_TARGET.project||
    env.RR003_SOURCE_BRANCH_ID!==RR003_TARGET.sourceBranch)
    refuse("project or source branch mismatch");
  if(mode!=="capture"&&mode!=="verify")refuse("unknown mode");
  const source=verifyCompareUrl(env.RR003_SOURCE_DATABASE_URL,
    RR001_TARGET.directHost);
  if(mode==="capture")return {source};
  const target=env.RR003_TARGET_BRANCH_ID;
  const host=env.RR003_TARGET_HOST;
  // A target branch must be confirmed by get_branch and list_branch_computes
  // before its ID and hostname are set. This is not a self-proving provider
  // identity: operators must also keep the signed provider response.
  assertRestoreBranchPlan({
    projectId:env.RR003_PROJECT_ID,
    sourceBranchId:env.RR003_SOURCE_BRANCH_ID,
    targetBranchId:target,
    parentBranchId:env.RR003_TARGET_PARENT_BRANCH_ID,
    restoreTimestampUtc:env.RR003_RESTORE_POINT_UTC,
    reviewedAtUtc:env.RR003_REVIEWED_AT_UTC,
    historyRetentionSeconds:Number(env.RR003_HISTORY_RETENTION_SECONDS),
  });
  if(!host||host===RR001_TARGET.directHost)refuse("target host must be distinct");
  const restored=verifyCompareUrl(env.RR003_RESTORE_DATABASE_URL,host);
  return {source,restored,targetBranchId:target};
}
export function compareDigests(baseline,candidate){
  if(baseline?.format!=="rr003-financial-baseline-v1"||
    candidate?.format!=="rr003-financial-baseline-v1")
    refuse("unsupported financial baseline format");
  if(baseline.projectId!==RR003_TARGET.project||
    baseline.branchId!==RR003_TARGET.sourceBranch||
    candidate.projectId!==RR003_TARGET.project)
    refuse("manifest project/source branch mismatch");
  const expectedNames=FINANCIAL_CLASSES.map(x=>x[0]);
  const classes=Object.keys(baseline.checks??{});
  if(classes.length!==expectedNames.length||
    classes.some(n=>!expectedNames.includes(n))||
    Object.keys(candidate.checks??{}).length!==expectedNames.length)
    refuse("incomplete conservation check classes");
  for(const name of expectedNames){
    const a=baseline.checks[name],b=candidate.checks?.[name];
    if(!a||!b||
      !Number.isSafeInteger(a.rows)||a.rows<0||
      !/^[a-f0-9]{64}$/.test(a.sha256??"")||
      a.rows!==b.rows||a.sha256!==b.sha256)
      refuse("immutable conservation mismatch: "+name);
  }
  return {checks:expectedNames.length,matched:true,releaseApproved:false};
}
async function collect(pool,branchId){
  const client=await pool.connect();
  try{
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await client.query("SET LOCAL statement_timeout='10s'");
    const id=await client.query("SELECT current_database() AS name");
    assert.equal(id.rows[0]?.name,RR003_TARGET.database);
    const checks={};
    for(const [label,table,order] of FINANCIAL_CLASSES){
      // All identifiers come only from the hard-coded allowlist above.
      const rows=await client.query("SELECT * FROM "+table+
        " ORDER BY "+order+" LIMIT "+(MAX_ROWS_PER_CLASS+1));
      if(rows.rows.length>MAX_ROWS_PER_CLASS)
        refuse("bounded read exceeded for "+label);
      const hash=createHash("sha256");
      for(const row of rows.rows)hash.update(JSON.stringify(row)+"\n");
      checks[label]={rows:rows.rows.length,sha256:hash.digest("hex")};
    }
    await client.query("COMMIT");
    return {format:"rr003-financial-baseline-v1",
      projectId:RR003_TARGET.project,branchId,
      capturedAt:new Date().toISOString(),checks};
  }catch(error){
    await client.query("ROLLBACK").catch(()=>{});
    throw error;
  }finally{client.release();}
}
export async function captureFinancialBaseline(env=process.env){
  const urls=verifyCompareEnvironment(env,"capture");
  const pool=new pg.Pool({connectionString:urls.source,max:1,
    connectionTimeoutMillis:10000});
  try{return await collect(pool,RR003_TARGET.sourceBranch);}
  finally{await pool.end();}
}
export async function verifyRestoredFinancialBaseline(baseline,env=process.env){
  const urls=verifyCompareEnvironment(env,"verify");
  const pool=new pg.Pool({connectionString:urls.restored,max:1,
    connectionTimeoutMillis:10000});
  try{
    const actual=await collect(pool,urls.targetBranchId);
    return {sourceBranchId:RR003_TARGET.sourceBranch,
      restoredBranchId:urls.targetBranchId,
      ...compareDigests(baseline,actual),
      restoreTimestampUtc:env.RR003_RESTORE_POINT_UTC,
      rpoMeasured:false,rtoMeasured:false,releaseApproved:false};
  }finally{await pool.end();}
}
const invoked=process.argv[1]&&
  pathToFileURL(resolve(process.argv[1])).href===import.meta.url;
if(invoked){
  const [mode,file]=process.argv.slice(2);
  try{
    if(!file||!["capture","verify"].includes(mode))
      refuse("usage: capture|verify <local-manifest-file>");
    const path=resolve(file);
    if(mode==="capture"){
      const manifest=await captureFinancialBaseline();
      mkdirSync(dirname(path),{recursive:true,mode:0o700});
      writeFileSync(path,JSON.stringify(manifest,null,2)+"\n",
        {flag:"wx",mode:0o600});
      console.log(JSON.stringify({mode:"capture",checks:FINANCIAL_CLASSES.length,
        localManifestCreated:true,restored:false,releaseApproved:false}));
    }else{
      const baseline=JSON.parse(readFileSync(path,"utf8"));
      const result=await verifyRestoredFinancialBaseline(baseline);
      console.log(JSON.stringify(result));
    }
  }catch(e){
    // Do not log database URLs, credentials, financial row content or SQL.
    console.error("RR-003 read-only restore comparison failed",
      e instanceof Error&&e.message.startsWith("RR-003 ")?e.message:
      e instanceof Error?e.name:"Unknown");
    process.exitCode=1;
  }
}
