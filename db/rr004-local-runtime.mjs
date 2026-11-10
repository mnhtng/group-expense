/** Disposable PG17 provisioning and test-fixture separation ONLY. */
import pg from 'pg';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {buildRuntimeGrantSql,readRuntimePrivileges,evaluateRuntimePrivileges} from './rr004-runtime-policy.mjs';
export const RR004_LOCAL_RUNTIME='postgresql://test:test@localhost:5432/group_expense';
export const RR004_LOCAL_OWNER='postgresql://rr004_owner:rr004-disposable-owner@localhost:5432/group_expense';
export function fixtureDatabaseUrl(env=process.env){
  if(!env.RR004_FIXTURE_DATABASE_URL)return env.DATABASE_URL;
  if(env.CI!=='true'||env.RR004_TEST_ONLY!=='isolated-pg17'||
    env.DATABASE_URL!==RR004_LOCAL_RUNTIME||env.RR004_FIXTURE_DATABASE_URL!==RR004_LOCAL_OWNER)
    throw Error('RR-004 refuses non-disposable fixture owner');
  return RR004_LOCAL_OWNER;
}
function guard(env){
  if(fixtureDatabaseUrl(env)!==RR004_LOCAL_OWNER)
    throw Error('RR-004 requires explicit disposable role profile');
}
export async function inspectLocalRuntime(env=process.env){
  guard(env);const pool=new pg.Pool({connectionString:RR004_LOCAL_RUNTIME,max:1});
  const c=await pool.connect();
  try{
    await c.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const snapshot=await readRuntimePrivileges(c);
    await c.query('COMMIT');return evaluateRuntimePrivileges(snapshot);
  }catch(e){await c.query('ROLLBACK');throw e;}
  finally{c.release();await pool.end();}
}
export async function provisionLocalRuntime(env=process.env){
  guard(env);
  if(env.RR004_PROVISION_RUNTIME!=='approved-disposable')
    throw Error('RR-004 local provisioning opt-in missing');
  const pool=new pg.Pool({connectionString:RR004_LOCAL_OWNER,max:1});
  const c=await pool.connect();
  try{
    await c.query('BEGIN');
    const r=(await c.query(`SELECT current_user AS role,current_database() AS db,
      current_setting('server_version_num')::int/10000 AS major,
      (SELECT count(*)::int FROM pg_roles WHERE rolname='test') AS existing`)).rows[0];
    if(r.role!=='rr004_owner'||r.db!=='group_expense'||r.major!==17||r.existing!==0)
      throw Error('RR-004 refuses existing role or unexpected disposable owner/version');
    await c.query("CREATE ROLE test LOGIN PASSWORD 'test' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS");
    await c.query(buildRuntimeGrantSql('test'));
    await c.query('COMMIT');
  }catch(e){await c.query('ROLLBACK');throw e;}
  finally{c.release();await pool.end();}
  return inspectLocalRuntime(env);
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  try{
    const mode=process.argv[2];
    if(!['provision','inspect'].includes(mode))throw Error('RR-004 mode must be provision or inspect');
    const result=await (mode==='provision'?provisionLocalRuntime():inspectLocalRuntime());
    console.log(JSON.stringify(result));if(!result.ok)process.exitCode=1;
  }catch(e){console.error('RR-004 disposable runtime check failed',e instanceof Error?e.name:'Unknown');process.exitCode=1;}
}
