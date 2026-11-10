import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import pg from 'pg';
import {buildRuntimeGrantSql,readRuntimePrivileges,evaluateRuntimePrivileges} from '../db/rr004-runtime-policy.mjs';

const base='postgresql://test:test@localhost:5432/group_expense';
test('SC025 operator-only bounded cohort, immutable audit and pause serialize with runtime writes',{timeout:30000},async()=>{
  assert.equal(process.env.CI,'true');assert.equal(process.env.DATABASE_URL,base);
  const suffix=randomUUID().replaceAll('-','');
  const db='group_expense_sc025_'+suffix,role='sc025_app_'+suffix;
  const admin=new pg.Pool({connectionString:base,max:1});
  const owner=new pg.Pool({connectionString:base.replace(/group_expense$/,db),max:3});
  const runtime=new pg.Pool({connectionString:`postgresql://${role}:local-only@localhost:5432/${db}`,max:1});
  try{
    await admin.query('CREATE DATABASE "'+db+'"');
    const migrated=spawnSync(process.execPath,['db/migrate.mjs'],{env:{...process.env,
      DATABASE_URL:base.replace(/group_expense$/,db),DATABASE_URL_DIRECT:''},encoding:'utf8',timeout:30000});
    assert.equal(migrated.status,0,migrated.stderr);
    assert.deepEqual((await owner.query('SELECT enabled,cohort_limit FROM settlement_cycle_engine_control')).rows,
      [{enabled:false,cohort_limit:1}]);
    await assert.rejects(owner.query('UPDATE settlement_cycle_engine_control SET enabled=true'),/empty rollout/);
    await assert.rejects(owner.query('UPDATE settlement_cycle_engine_control SET cohort_limit=2'),e=>e.code==='23514');
    const actor=randomUUID(),groups=Array.from({length:6},()=>randomUUID());
    await owner.query('INSERT INTO "user"(id,name,email) VALUES($1,$2,$3)',[actor,'SC025 synthetic',actor+'@example.test']);
    for(const id of groups)await owner.query('INSERT INTO groups(id,owner_id,name) VALUES($1,$2,$3)',[id,actor,'SC025 synthetic']);
    const admission=await Promise.allSettled(groups.slice(0,2).map(id=>owner.query(
      'INSERT INTO settlement_cycle_engine_cohort(group_id) VALUES($1)',[id])));
    assert.equal(admission.filter(r=>r.status==='fulfilled').length,1);
    assert.equal(admission.filter(r=>r.status==='rejected'&&/capacity exceeded/.test(r.reason.message)).length,1);
    const winner=(await owner.query('SELECT group_id FROM settlement_cycle_engine_cohort WHERE admitted')).rows[0].group_id;
    await owner.query('UPDATE settlement_cycle_engine_control SET enabled=true');
    await owner.query(`CREATE ROLE "${role}" LOGIN PASSWORD 'local-only' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS`);
    await owner.query(buildRuntimeGrantSql(role).replaceAll('DATABASE group_expense','DATABASE "'+db+'"'));
    assert.equal(evaluateRuntimePrivileges(await readRuntimePrivileges(runtime)).ok,true);
    await owner.query('ALTER TABLE settlement_cycle_engine_control DISABLE TRIGGER sc025_control_guard');
    assert.equal(evaluateRuntimePrivileges(await readRuntimePrivileges(runtime)).ok,false);
    await owner.query('ALTER TABLE settlement_cycle_engine_control ENABLE TRIGGER sc025_control_guard');
    for(const statement of [
      'UPDATE settlement_cycle_engine_control SET enabled=false',
      'INSERT INTO settlement_cycle_engine_cohort(group_id) VALUES($1)',
      'UPDATE settlement_cycle_engine_cohort SET admitted=false',
      'INSERT INTO settlement_cycle_engine_events(subject,after_state) VALUES(\'control\',\'{}\')',
    ])await assert.rejects(runtime.query(statement,statement.includes('$1')?[groups[2]]:[]),e=>e.code==='42501');
    const reader=await runtime.connect(),operator=await owner.connect();
    try{
      await reader.query('BEGIN');
      await reader.query('SELECT pg_advisory_xact_lock_shared(250025,1)');
      await operator.query('BEGIN');await operator.query("SET LOCAL lock_timeout='100ms'");
      await assert.rejects(operator.query('UPDATE settlement_cycle_engine_control SET enabled=false'),e=>e.code==='55P03');
      await operator.query('ROLLBACK');await reader.query('COMMIT');
      await operator.query('UPDATE settlement_cycle_engine_control SET enabled=false');
      assert.equal((await reader.query('SELECT enabled FROM settlement_cycle_engine_control')).rows[0].enabled,false);
    }finally{await reader.query('ROLLBACK');await operator.query('ROLLBACK');reader.release();operator.release();}
    await owner.query('UPDATE settlement_cycle_engine_control SET cohort_limit=5');
    for(const id of groups.filter(id=>id!==winner).slice(0,4))await owner.query(
      'INSERT INTO settlement_cycle_engine_cohort(group_id) VALUES($1)',[id]);
    const outside=groups.find(id=>![winner,...groups.filter(id=>id!==winner).slice(0,4)].includes(id));
    await assert.rejects(owner.query('INSERT INTO settlement_cycle_engine_cohort(group_id) VALUES($1)',[outside]),/capacity exceeded/);
    await assert.rejects(owner.query('UPDATE settlement_cycle_engine_control SET cohort_limit=1'),/cannot exclude/);
    await owner.query('UPDATE settlement_cycle_engine_control SET cohort_limit=25');
    await owner.query('INSERT INTO settlement_cycle_engine_cohort(group_id) VALUES($1)',[outside]);
    await assert.rejects(owner.query('UPDATE settlement_cycle_engine_control SET cohort_limit=5'),/cannot exclude/);
    await owner.query('UPDATE settlement_cycle_engine_cohort SET admitted=false WHERE group_id=$1',[outside]);
    await owner.query('UPDATE settlement_cycle_engine_control SET cohort_limit=5');
    await owner.query('UPDATE settlement_cycle_engine_control SET enabled=true');
    await owner.query('UPDATE settlement_cycle_engine_cohort SET admitted=false WHERE group_id<>$1',[winner]);
    await assert.rejects(owner.query('UPDATE settlement_cycle_engine_cohort SET admitted=false WHERE group_id=$1',[winner]),/Pause rollout/);
    for(const statement of ['UPDATE settlement_cycle_engine_events SET operator_role=operator_role',
      'DELETE FROM settlement_cycle_engine_events','TRUNCATE settlement_cycle_engine_events',
      'DELETE FROM settlement_cycle_engine_cohort','TRUNCATE settlement_cycle_engine_cohort',
      'DELETE FROM settlement_cycle_engine_control','TRUNCATE settlement_cycle_engine_control'])
      await assert.rejects(owner.query(statement));
    const audit=await owner.query('SELECT count(*)::int AS n,bool_and(operator_role=current_user) AS operators FROM settlement_cycle_engine_events');
    assert.ok(audit.rows[0].n>=10);assert.equal(audit.rows[0].operators,true);
  }finally{
    await runtime.end();await owner.end();
    await admin.query('DROP DATABASE IF EXISTS "'+db+'"');
    await admin.query('DROP ROLE IF EXISTS "'+role+'"');await admin.end();
  }
});
