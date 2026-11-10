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
export const BASELINE_FORMAT="rr003-financial-baseline-v2";
import {FINANCIAL_CLASSES} from "./financial-inventory.mjs";
export {FINANCIAL_CLASSES} from "./financial-inventory.mjs";
// Migration-file checksums do not detect a disabled trigger or altered SQL
// function. Compare restored database definitions independently of that log.
const SCHEMA_QUERIES=Object.freeze([
  ["schema_columns",`SELECT table_name,column_name,ordinal_position,data_type,
    udt_schema,udt_name,is_nullable,column_default
    FROM information_schema.columns WHERE table_schema='public'
    ORDER BY table_name,ordinal_position`],
  ["schema_constraints",`SELECT c.relname,k.conname,k.convalidated,
    pg_get_constraintdef(k.oid,true) AS definition FROM pg_constraint k
    JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' ORDER BY c.relname,k.conname`],
  ["schema_triggers",`SELECT c.relname,t.tgname,t.tgenabled,
    pg_get_triggerdef(t.oid,true) AS definition FROM pg_trigger t
    JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND NOT t.tgisinternal ORDER BY c.relname,t.tgname`],
  ["schema_functions",`SELECT p.proname,pg_get_function_identity_arguments(p.oid) AS args,
    pg_get_functiondef(p.oid) AS definition FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.prokind IN('f','p') ORDER BY p.proname,args`],
  ["schema_views",`SELECT viewname,definition FROM pg_views
    WHERE schemaname='public' ORDER BY viewname`],
  ["schema_indexes",`SELECT tablename,indexname,indexdef FROM pg_indexes
    WHERE schemaname='public' ORDER BY tablename,indexname`],
]);
export const CHECK_NAMES=Object.freeze([
  ...FINANCIAL_CLASSES.map(x=>x[0]),...SCHEMA_QUERIES.map(x=>x[0]),
]);
const refuse=message=>{throw Error("RR-003 comparison refused: "+message);};

export function financialDigestQueries(){
  return [...FINANCIAL_CLASSES.map(([label,table,order])=>[label,
    'SELECT to_jsonb(t)::text AS canonical FROM public."'+table+
      '" t ORDER BY '+order+" LIMIT "+(MAX_ROWS_PER_CLASS+1)]),
    ...SCHEMA_QUERIES.map(([label,sql])=>[label,
      "SELECT to_jsonb(t)::text AS canonical FROM ("+sql+") t LIMIT "+(MAX_ROWS_PER_CLASS+1)]),
  ];
}

/** One SELECT for provider connectors that keep credentials private. All
 * classes share one statement snapshot. Test equality against the direct
 * client's canonical digests before using this for a managed restore.
 */
export function buildProviderDigestSql(branchId){
  if(typeof branchId!=="string"||!/^br-[a-z0-9-]+$/.test(branchId))
    refuse("invalid provider branch identity");
  const inventory=FINANCIAL_CLASSES.map(x=>x[1])
    .filter(name=>name!=="bn005_obligation_balances").sort();
  const results=financialDigestQueries().map(([label,sql])=>`
    SELECT '${label}' AS label,d.rows,d.sha256 FROM config c
    CROSS JOIN LATERAL (
      SELECT count(*)::int AS rows,
        encode(sha256(convert_to(COALESCE(string_agg(
          t.canonical||chr(10),'' ORDER BY t.position),''),'UTF8')),'hex') AS sha256
      FROM (SELECT row_number() OVER() AS position,q.canonical
        FROM (${sql}) q WHERE c.tz='UTC' AND c.dates='ISO, YMD'
          AND c.path='public,pg_catalog') t
    ) d`).join("\nUNION ALL\n");
  return `WITH config AS MATERIALIZED (
    SELECT set_config('TimeZone','UTC',true) AS tz,
      set_config('DateStyle','ISO, YMD',true) AS dates,
      set_config('search_path','public,pg_catalog',true) AS path
  ), results AS (${results})
  SELECT jsonb_build_object(
    'format','${BASELINE_FORMAT}','projectId','${RR003_TARGET.project}',
    'branchId','${branchId}',
    'capturedAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'checks',(SELECT jsonb_object_agg(label,jsonb_build_object('rows',rows,'sha256',sha256)) FROM results)
  ) AS manifest,
    (SELECT array_agg(tablename::text ORDER BY tablename) FROM pg_tables
      WHERE schemaname='public')=ARRAY[${inventory.map(n=>"'"+n+"'").join(",")}]::text[] AS "inventoryMatches",
    current_database() AS database,
    current_setting('server_version_num')::int/10000 AS "pgMajor"
  FROM config`;
}

export function validateProviderDigests(row,branchId,database=RR003_TARGET.database){
  const manifest=row?.manifest;
  if(row?.inventoryMatches!==true||row.pgMajor!==17||row.database!==database||
    manifest?.format!==BASELINE_FORMAT||manifest.projectId!==RR003_TARGET.project||
    manifest.branchId!==branchId||!Number.isFinite(Date.parse(manifest.capturedAt))||
    Object.keys(manifest.checks??{}).length!==CHECK_NAMES.length)
    refuse("provider digest metadata or inventory mismatch");
  for(const name of CHECK_NAMES){
    const check=manifest.checks[name];
    if(!Number.isSafeInteger(check?.rows)||check.rows<0||check.rows>MAX_ROWS_PER_CLASS||
      !/^[a-f0-9]{64}$/.test(check.sha256??""))
      refuse("invalid or truncated provider digest: "+name);
  }
  return manifest;
}

export function verifyCompareUrl(raw,requiredHost){
  if(typeof raw!=="string"||!raw||typeof requiredHost!=="string"||
    !/^ep-[a-z0-9-]+\.c-\d+\.[a-z0-9-]+\.aws\.neon\.tech$/.test(requiredHost))
    refuse("pinned Neon compute hostname required");
  let u;
  try{u=new URL(raw);}catch{refuse("malformed database URL");}
  const allowedParams=new Set(["sslmode","channel_binding"]);
  if(!["postgres:","postgresql:"].includes(u.protocol)||u.hostname!==requiredHost||
    u.pathname!=="/"+RR003_TARGET.database||
    u.hash||(u.port&&u.port!=="5432")||
    !u.username||!u.password||
    requiredHost.includes("-pooler.")||
    [...u.searchParams.keys()].some(key=>!allowedParams.has(key))||
    (u.searchParams.has("channel_binding")&&
      u.searchParams.get("channel_binding")!=="require")||
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
  if(baseline?.format!==BASELINE_FORMAT||
    candidate?.format!==BASELINE_FORMAT)
    refuse("unsupported financial baseline format");
  if(baseline.projectId!==RR003_TARGET.project||
    baseline.branchId!==RR003_TARGET.sourceBranch||
    candidate.projectId!==RR003_TARGET.project)
    refuse("manifest project/source branch mismatch");
  if(typeof candidate.branchId!=="string"||!/^br-[a-z0-9-]+$/.test(candidate.branchId)||
    candidate.branchId===baseline.branchId||
    RR003_TARGET.excludedBranches.includes(candidate.branchId))
    refuse("manifest destination must be an independent isolated branch");
  const expectedNames=CHECK_NAMES;
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
export async function collectFinancialDigests(pool,branchId,database=RR003_TARGET.database){
  const client=await pool.connect();
  try{
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await client.query("SET LOCAL statement_timeout='10s'");
    await client.query("SET LOCAL TIME ZONE 'UTC'");
    await client.query("SET LOCAL DateStyle='ISO, YMD'");
    await client.query("SET LOCAL search_path=public,pg_catalog");
    const id=await client.query("SELECT current_database() AS name");
    assert.equal(id.rows[0]?.name,database);
    const inventory=await client.query(`SELECT tablename FROM pg_tables
      WHERE schemaname='public' ORDER BY tablename`);
    const expectedTables=FINANCIAL_CLASSES.map(x=>x[1])
      .filter(name=>name!=="bn005_obligation_balances").sort();
    if(JSON.stringify(inventory.rows.map(x=>x.tablename))!==JSON.stringify(expectedTables))
      refuse("public table inventory differs from approved recovery coverage");
    const checks={};
    for(const [label,sql] of financialDigestQueries()){
      // JS Date/JSON parsing would lose timestamp/numeric precision here.
      const rows=await client.query(sql);
      if(rows.rows.length>MAX_ROWS_PER_CLASS)
        refuse("bounded read exceeded for "+label);
      const hash=createHash("sha256");
      for(const row of rows.rows)hash.update(row.canonical+"\n");
      checks[label]={rows:rows.rows.length,sha256:hash.digest("hex")};
    }
    await client.query("COMMIT");
    return {format:BASELINE_FORMAT,
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
  try{return await collectFinancialDigests(pool,RR003_TARGET.sourceBranch);}
  finally{await pool.end();}
}
export async function verifyRestoredFinancialBaseline(baseline,env=process.env){
  const urls=verifyCompareEnvironment(env,"verify");
  const pool=new pg.Pool({connectionString:urls.restored,max:1,
    connectionTimeoutMillis:10000});
  try{
    const actual=await collectFinancialDigests(pool,urls.targetBranchId);
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
      console.log(JSON.stringify({mode:"capture",checks:CHECK_NAMES.length,
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
