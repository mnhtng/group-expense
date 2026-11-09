/**
 * SC-007 independent, READ-ONLY cross-table reconciliation.
 * This command intentionally refuses any non-disposable database. No ORM.
 * Never allow a release or production mutation from an audit result.
 */
import {FINANCIAL_AUDIT_QUERIES} from "./sc007-audit-queries.mjs";
import pg from "pg";

const CI_DATABASE="postgresql://test:test@localhost:5432/group_expense";
if(process.env.CI!=="true"||process.env.DATABASE_URL!==CI_DATABASE||
  process.env.SC007_TEST_ONLY!=="isolated-pg17"){
  console.error("SC-007 audit refuses non-disposable database");
  process.exit(2);
}
const pool=new pg.Pool({connectionString:CI_DATABASE,max:1});
const checks=[];

async function assertZero(client,name,sql,params=[]){
  const r=await client.query(sql,params);
  if(r.rows.length)throw new Error(`${name}: ${r.rows.length} mismatches; first ${JSON.stringify(r.rows[0])}`);
  checks.push({name,violations:0});
}
const run=async()=>{
  const c=await pool.connect();
  try{
    await c.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    for(const [name,sql] of FINANCIAL_AUDIT_QUERIES)
      await assertZero(c,name,sql);
    const stats=await c.query(`SELECT
      (SELECT count(*)::int FROM obligations) AS obligations,
      (SELECT count(*)::int FROM settlements) AS cash_records,
      (SELECT count(*)::int FROM group_settlement_bilateral_applications) AS applied_noncash,
      (SELECT count(*)::int FROM group_settlement_cycle_snapshot_obligations) AS frozen_sources,
      (SELECT count(*)::int FROM group_settlement_cycle_adjustments) AS late_assignments`);
    await c.query("COMMIT");
    console.log(JSON.stringify({sc007:"AUDIT_PASS",database:"disposable-pg17",
      checks,stats:stats.rows[0],financialEngineEnabled:false},null,2));
  }catch(e){await c.query("ROLLBACK");throw e;}
  finally{c.release();}
};
try{await run();}finally{await pool.end();}
