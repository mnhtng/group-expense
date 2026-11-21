import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {buildRuntimeGrantSql,readRuntimePrivileges,evaluateRuntimePrivileges} from '../db/rr004-runtime-policy.mjs';
import {CASH_INTENT_RUNTIME_PRIVILEGES_SQL,projectCashIntentRuntimePrivileges,
  evaluateCashIntentRuntimePrivileges} from '../db/runtime-finance-policy.mjs';
const url='postgresql://test:test@localhost:5432/group_expense';
test('RR-004 real non-owner LOGIN cannot edit audit bodies, change money, run DDL or assume owner',async()=>{
  assert.equal(process.env.CI,'true');assert.equal(process.env.DATABASE_URL,url);
  const owner=new pg.Pool({connectionString:url,max:1});
  const name='rr004_'+randomUUID().replaceAll('-','');
  const runtimeUrl=new URL(url);runtimeUrl.username=name;runtimeUrl.password='synthetic-runtime-password';
  const runtime=new pg.Pool({connectionString:runtimeUrl.href,max:1});
  try{
    await owner.query('CREATE ROLE "'+name+'" LOGIN PASSWORD \'synthetic-runtime-password\' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS');
    await owner.query(buildRuntimeGrantSql(name));
    const identity=(await runtime.query('SELECT current_user AS role,session_user AS login')).rows[0];
    assert.deepEqual(identity,{role:name,login:name},'must be a real limited login, not SET ROLE on an owner session');
    const assertCashAccess=async expected=>{
      const current=(await runtime.query(CASH_INTENT_RUNTIME_PRIVILEGES_SQL)).rows[0];
      const evaluated=evaluateCashIntentRuntimePrivileges(
        projectCashIntentRuntimePrivileges(current));
      assert.equal(evaluated.ok,expected,JSON.stringify(evaluated.reasons));
    };
    await assertCashAccess(true);
    await runtime.query('SELECT id FROM group_settlement_bilateral_cash_intents LIMIT 0');
    // Reproduce the staging incident: owner creates migration 030 while the
    // non-owner app never receives SELECT on the newly created table.
    await owner.query('REVOKE SELECT ON group_settlement_bilateral_cash_intents FROM "'+name+'"');
    try{
      await assertCashAccess(false);
      await assert.rejects(
        runtime.query('SELECT id FROM group_settlement_bilateral_cash_intents LIMIT 0'),
        e=>e.code==='42501',
        'the real runtime login must fail exactly as the staging 500 did');
    }finally{
      await owner.query('GRANT SELECT ON group_settlement_bilateral_cash_intents TO "'+name+'"');
    }
    await assertCashAccess(true);
    const good=evaluateRuntimePrivileges(await readRuntimePrivileges(runtime));
    assert.equal(good.ok,true,JSON.stringify(good));
    await owner.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO "${name}"`);
    assert.equal(evaluateRuntimePrivileges(await readRuntimePrivileges(runtime)).ok,false,
      'future automatic grants require explicit review too');
    await owner.query(buildRuntimeGrantSql(name));
    assert.equal(evaluateRuntimePrivileges(await readRuntimePrivileges(runtime)).ok,true);
    for(const sql of [
      'CREATE TABLE rr004_denied(id integer)',
      'CREATE TEMP TABLE rr004_denied(id integer)',
      'ALTER TABLE expense_events DISABLE TRIGGER ALL',
      'TRUNCATE settlement_events',
      "UPDATE expense_events SET snapshot='{}' WHERE false",
      "UPDATE obligations SET amount_minor=1 WHERE false",
      "UPDATE settlements SET amount_minor=1 WHERE false",
      'DELETE FROM group_settlement_cycle_disputes WHERE false',
      'SET ROLE test',
      'SET SESSION AUTHORIZATION test',
    ])await assert.rejects(runtime.query(sql),e=>e.code==='42501',sql);
    await runtime.query('BEGIN');
    await runtime.query('SELECT id FROM group_settlement_bilateral_proposals FOR UPDATE');
    await runtime.query('ROLLBACK');
    await owner.query('GRANT UPDATE(reason) ON group_settlement_cycle_disputes TO "'+name+'"');
    assert.equal(evaluateRuntimePrivileges(await readRuntimePrivileges(runtime)).ok,false,
      'unexpected old column grants must be detected even without table-level UPDATE');
    await owner.query('REVOKE UPDATE(reason) ON group_settlement_cycle_disputes FROM "'+name+'"');
    for(const [privilege,column] of [['INSERT','filename'],['REFERENCES','filename']]){
      await owner.query(`GRANT ${privilege}(${column}) ON schema_migrations TO "${name}"`);
      assert.equal(evaluateRuntimePrivileges(await readRuntimePrivileges(runtime)).ok,false,
        'column-level authority cannot bypass the table privilege profile');
      await owner.query(`REVOKE ${privilege}(${column}) ON schema_migrations FROM "${name}"`);
    }
    await owner.query('ALTER TABLE group_settlement_bilateral_proposals DISABLE TRIGGER bn002_proposal_immutable');
    try{
      assert.ok(evaluateRuntimePrivileges(await readRuntimePrivileges(runtime)).blockerCodes
        .includes('IMMUTABLE_LOCK_GUARD_MISSING'));
    }finally{
      await owner.query('ALTER TABLE group_settlement_bilateral_proposals ENABLE TRIGGER bn002_proposal_immutable');
    }
    await owner.query('ALTER TABLE expense_events DISABLE TRIGGER rr004_expense_audit_no_truncate');
    try{
      assert.equal(evaluateRuntimePrivileges(await readRuntimePrivileges(runtime)).ok,false,
        'legacy audit protections are required by the runtime profile too');
    }finally{
      await owner.query('ALTER TABLE expense_events ENABLE TRIGGER rr004_expense_audit_no_truncate');
    }
  }finally{
    await runtime.end();
    await owner.query('DROP OWNED BY "'+name+'"');
    await owner.query('DROP ROLE "'+name+'"');
    await owner.end();
  }
});
