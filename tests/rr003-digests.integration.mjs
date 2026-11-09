import {test} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import pg from "pg";
import {spawnSync} from "node:child_process";
import {FINANCIAL_CLASSES,collectFinancialDigests,compareDigests} from "../db/rr003-restore-compare.mjs";
import {RR003_TARGET} from "../db/rr003-recovery-policy.mjs";

const url="postgresql://test:test@localhost:5432/group_expense";
test("RR-003 SQL digests cover every public table and preserve timestamp microseconds",async()=>{
  assert.equal(process.env.CI,"true");
  assert.equal(process.env.DATABASE_URL,url);
  const admin=new pg.Pool({connectionString:url,max:1});
  const database="group_expense_rr003_"+randomUUID().replaceAll("-","");
  const isolatedUrl=url.replace(/group_expense$/,database);
  const pool=new pg.Pool({connectionString:isolatedUrl,max:1});
  const id=randomUUID();
  try{
    await admin.query('CREATE DATABASE "'+database+'"');
    const migration=spawnSync(process.execPath,["db/migrate.mjs"],{
      env:{...process.env,DATABASE_URL:isolatedUrl,DATABASE_URL_DIRECT:""},
      encoding:"utf8",timeout:20000,
    });
    assert.equal(migration.status,0,migration.stderr);
    const tables=(await pool.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows.map(x=>x.tablename);
    const covered=FINANCIAL_CLASSES.map(x=>x[1]).filter(x=>x!=="bn005_obligation_balances").sort();
    assert.deepEqual(covered,tables,"new tables must be added explicitly to recovery coverage");
    await pool.query(`INSERT INTO "user"(id,name,email,"createdAt")
      VALUES($1,'RR003 precision fixture',$2,'2026-11-09T01:02:03.123456Z')`,[id,id+"@example.test"]);
    const before=await collectFinancialDigests(pool,RR003_TARGET.sourceBranch,database);
    // This is a new synthetic identity, not an original ledger or audit row.
    await pool.query(`UPDATE "user" SET "createdAt"='2026-11-09T01:02:03.123457Z' WHERE id=$1`,[id]);
    const after=await collectFinancialDigests(pool,"br-rr003-disposable-test",database);
    assert.equal(before.checks.users.rows,after.checks.users.rows);
    assert.notEqual(before.checks.users.sha256,after.checks.users.sha256,
      "one microsecond must never disappear through JS Date parsing");
    assert.throws(()=>compareDigests(before,after),/immutable conservation mismatch: users/);
    const precision=(await pool.query(`SELECT to_jsonb(x)::text AS canonical FROM
      (SELECT '{"amount":9007199254740993}'::jsonb AS payload) x`)).rows[0].canonical;
    assert.ok(precision.includes("9007199254740993"));
    const schemaBefore=await collectFinancialDigests(pool,RR003_TARGET.sourceBranch,database);
    // Simulate administrator tampering in this NEW throwaway database only.
    await pool.query("ALTER TABLE expense_events DISABLE TRIGGER rr004_expense_audit_immutable");
    const schemaAfter=await collectFinancialDigests(pool,"br-rr003-disposable-test",database);
    assert.throws(()=>compareDigests(schemaBefore,schemaAfter),/immutable conservation mismatch: schema_triggers/);
    await pool.query("CREATE TABLE rr003_uncovered_fixture(id integer PRIMARY KEY)");
    await assert.rejects(collectFinancialDigests(pool,RR003_TARGET.sourceBranch,database),
      /public table inventory differs from approved recovery coverage/);
  }finally{
    await pool.end();
    await admin.query('DROP DATABASE IF EXISTS "'+database+'"');
    await admin.end();
  }
});
