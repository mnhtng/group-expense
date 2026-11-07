/**
 * RR-001: isolated Neon schema-rehearsal target preflight. READ ONLY.
 *
 * This deliberately never applies migrations or changes financial data.
 * Pinned hostnames are the current Neon compute endpoint for the isolated
 * branch; revalidate Neon API branch/compute ownership before any future
 * schema rehearsal. No URL, credential or financial detail is logged.
 */
import {createHash} from "node:crypto";
import {readFile,readdir} from "node:fs/promises";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";

export const RR001_TARGET=Object.freeze({
  project:"withered-salad-00928018",
  branch:"br-curly-rice-b3xenws6",
  database:"group_expense",
  directHost:"ep-holy-hill-b39kdqz6.c-4.ap-southeast-1.aws.neon.tech",
  pooledHost:"ep-holy-hill-b39kdqz6-pooler.c-4.ap-southeast-1.aws.neon.tech",
});
const refuse=message=>{throw Error("RR-001 refused: "+message);};

function verifyUrl(raw,label,hostname){
  if(typeof raw!=="string"||!raw)refuse(label+" is missing");
  let u;
  try{u=new URL(raw);}catch{refuse(label+" is not a valid URL");}
  if(u.protocol!=="postgres:"&&u.protocol!=="postgresql:")
    refuse(label+" must use PostgreSQL");
  if(u.hostname!==hostname)refuse(label+" points outside the pinned child endpoint");
  if(u.pathname!=="/"+RR001_TARGET.database)
    refuse(label+" database mismatch");
  if(u.port&&u.port!=="5432")refuse(label+" port mismatch");
  if(!u.username||!u.password)refuse(label+" credentials missing");
  if(!["require","verify-ca","verify-full"].includes(u.searchParams.get("sslmode")))
    refuse(label+" requires TLS");
  if(u.hash)refuse(label+" URL fragment is forbidden");
  return u;
}

/** Offline identity check; guaranteed no database access. */
export function verifyRR001Environment(env=process.env){
  if(env.RR001_PROJECT_ID!==RR001_TARGET.project)
    refuse("project identity mismatch");
  if(env.RR001_BRANCH_ID!==RR001_TARGET.branch)
    refuse("branch identity mismatch");
  const runtime=verifyUrl(env.DATABASE_URL,"DATABASE_URL",RR001_TARGET.pooledHost);
  const direct=verifyUrl(env.DATABASE_URL_DIRECT,
    "DATABASE_URL_DIRECT",RR001_TARGET.directHost);
  if(runtime.username!==direct.username)
    refuse("runtime/migration role mismatch");
  if(runtime.password!==direct.password)
    refuse("runtime/migration credential mismatch");
  return {runtimeUrl:runtime.toString(),directUrl:direct.toString()};
}

async function verifyMigrationChecksums(rows){
  const names=(await readdir(new URL("./migrations/",import.meta.url)))
    .filter(name=>/^\d+_[\w-]+\.sql$/.test(name)).sort();
  if(names.length!==23)refuse("expected 23 versioned migration files");
  const installed=rows.map(r=>r.filename);
  if(installed.length!==10&&installed.length!==23)
    refuse("database is not at an approved baseline or complete schema state");
  if(installed.some((name,i)=>name!==names[i]))
    refuse("installed migrations are not the exact expected prefix");
  for(const row of rows){
    const source=await readFile(new URL("./migrations/"+row.filename,import.meta.url),"utf8");
    const checksum=createHash("sha256").update(source).digest("hex");
    if(row.checksum_sha256!==checksum)
      refuse("installed migration checksum drift");
  }
  return {installedCount:installed.length,latest:installed.at(-1)};
}

/** Read-only repeatable-read audit. Never claims finance release readiness. */
export async function readRR001Baseline(env=process.env){
  const {directUrl}=verifyRR001Environment(env);
  const pg=await import("pg");
  const pool=new pg.default.Pool({
    connectionString:directUrl,max:1,connectionTimeoutMillis:10000,
  });
  let client;
  try{
    client=await pool.connect();
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const identity=await client.query(
      "SELECT current_database() AS db, current_user AS role");
    if(identity.rows[0]?.db!==RR001_TARGET.database)
      refuse("server-reported database mismatch");
    const versions=await client.query(
      "SELECT filename,checksum_sha256 FROM schema_migrations ORDER BY filename");
    const migration=await verifyMigrationChecksums(versions.rows);
    const counts=await client.query(`SELECT
      (SELECT count(*)::int FROM expenses) AS expenses,
      (SELECT count(*)::int FROM obligations) AS obligations`);
    await client.query("COMMIT");
    return {project:RR001_TARGET.project,branch:RR001_TARGET.branch,
      database:RR001_TARGET.database,...migration,
      originalExpenseRows:counts.rows[0].expenses,
      originalObligationRows:counts.rows[0].obligations,
      financialEngineActivated:false,
      schemaWritePerformed:false,
      releaseDecision:"NO-GO"};
  }catch(e){
    if(client)await client.query("ROLLBACK").catch(()=>{});
    throw e;
  }finally{
    client?.release();
    await pool.end();
  }
}

const invoked=process.argv[1]?
  pathToFileURL(resolve(process.argv[1])).href===import.meta.url:false;
if(invoked){
  readRR001Baseline().then(result=>{
    // Redacted operational output; no URLs, secrets, users or amounts.
    console.log(JSON.stringify(result,null,2));
  }).catch(e=>{
    console.error("RR-001 preflight failed",
      e instanceof Error&&e.message.startsWith("RR-001 refused:")?e.message:
      e instanceof Error?e.name:"Unknown");
    process.exitCode=1;
  });
}
