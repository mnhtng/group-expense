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
    await owner.query('UPDATE settlement_cycle_engine_cohort SET admitted=false WHERE group_id=$1',[winner]);
    assert.equal((await owner.query("SELECT count(*)::int AS n FROM settlement_cycle_engine_cohort WHERE admitted")).rows[0].n,0,
      "revoking the last admitted group must leave no authorized writers");
    assert.equal((await owner.query("SELECT enabled FROM settlement_cycle_engine_control WHERE id=1")).rows[0].enabled,true,
      "the global kill switch remains an independent operator-only control");
    await assert.rejects(owner.query("UPDATE settlement_cycle_engine_control SET cohort_limit=25"),/empty rollout/,
      "operators cannot modify the enabled control while the cohort is empty");
    await owner.query("UPDATE settlement_cycle_engine_control SET enabled=false");
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

test('SC027 scoped role uses audited owner function without any table DML privileges',
  {timeout:30000},async()=>{
  assert.equal(process.env.CI,'true');assert.equal(process.env.DATABASE_URL,base);
  const suffix=randomUUID().replaceAll('-','');
  const db='group_expense_sc027_'+suffix,role='sc027_owner_'+suffix;
  const admin=new pg.Pool({connectionString:base,max:1});
  const owner=new pg.Pool({connectionString:base.replace(/group_expense$/,db),max:1});
  const scoped=new pg.Pool({connectionString:`postgresql://${role}:local-only@localhost:5432/${db}`,max:1});
  const actor=randomUUID(),outsider=randomUUID(),g=randomUUID();
  const sql=`SELECT public.sc027_owner_cohort_change(
    $1::uuid,$2::text,$3::boolean,$4::boolean,$5::integer) AS admitted`;
  try{
    await admin.query('CREATE DATABASE "'+db+'"');
    const migration=spawnSync(process.execPath,['db/migrate.mjs'],{
      env:{...process.env,DATABASE_URL:base.replace(/group_expense$/,db),
        DATABASE_URL_DIRECT:''},encoding:'utf8',timeout:30000});
    assert.equal(migration.status,0,migration.stderr);
    await owner.query('INSERT INTO "user"(id,name,email) VALUES($1,$2,$3)',
      [actor,'SC027 owner','sc027-'+actor+'@example.test']);
    await owner.query("INSERT INTO groups(id,owner_id,name) VALUES($1,$2,'Owner rollout test')",[g,actor]);
    await owner.query("INSERT INTO group_members(group_id,user_id,role) VALUES($1,$2,'owner')",[g,actor]);
    await owner.query("INSERT INTO group_settlement_settings(group_id,requested_enabled,requested_bilateral_netting,updated_by) VALUES($1,true,true,$2)",[g,actor]);
    await owner.query('CREATE ROLE "'+role+'" LOGIN PASSWORD \'local-only\' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS');
    await owner.query('GRANT CONNECT ON DATABASE "'+db+'" TO "'+role+'"');
    await owner.query('GRANT USAGE ON SCHEMA public TO "'+role+'"');
    await owner.query('GRANT EXECUTE ON FUNCTION public.sc027_owner_cohort_change(uuid,text,boolean,boolean,integer) TO "'+role+'"');
    const permissions=await scoped.query(`SELECT
      has_table_privilege(current_user,'public.groups','UPDATE') AS "groupsWrite",
      has_table_privilege(current_user,'public.settlements','INSERT') AS "moneyWrite",
      has_table_privilege(current_user,'public.settlement_cycle_engine_control','UPDATE') AS "globalWrite",
      has_table_privilege(current_user,'public.settlement_cycle_engine_cohort','INSERT') AS "cohortWrite",
      has_function_privilege(current_user,'public.sc027_owner_cohort_change(uuid,text,boolean,boolean,integer)','EXECUTE') AS "canExecute"`);
    assert.deepEqual(permissions.rows[0],{
      groupsWrite:false,moneyWrite:false,globalWrite:false,cohortWrite:false,canExecute:true});
    await assert.rejects(scoped.query('INSERT INTO settlement_cycle_engine_cohort(group_id) VALUES($1)',[g]),
      e=>e.code==='42501');
    await assert.rejects(scoped.query(sql,[g,outsider,true,false,1]),e=>e.code==='42501');
    assert.equal((await scoped.query(sql,[g,actor,true,false,1])).rows[0].admitted,true);
    await assert.rejects(scoped.query(sql,[g,actor,false,false,1]),e=>e.code==='40001');
    assert.equal((await owner.query('SELECT enabled FROM settlement_cycle_engine_control WHERE id=1')).rows[0].enabled,false);
    await assert.rejects(scoped.query('UPDATE settlement_cycle_engine_control SET enabled=true'),
      e=>e.code==='42501');
    await owner.query('UPDATE settlement_cycle_engine_control SET enabled=true');
    assert.equal((await scoped.query(sql,[g,actor,false,true,2])).rows[0].admitted,false);
    assert.equal((await owner.query('SELECT count(*)::int AS n FROM settlement_cycle_engine_cohort WHERE admitted')).rows[0].n,0);
    assert.equal((await owner.query('SELECT enabled FROM settlement_cycle_engine_control WHERE id=1')).rows[0].enabled,true,
      'group revoke must never turn off or on the operator kill switch');
    const audit=await owner.query('SELECT count(*)::int AS n FROM settlement_cycle_engine_events WHERE group_id=$1',[g]);
    assert.equal(audit.rows[0].n,2);
    const actorHistory=await owner.query(`SELECT count(*)::int AS n FROM group_settlement_config_events
      WHERE group_id=$1 AND actor_id=$2 AND details->>'subject'='owner_financial_activation'`,[g,actor]);
    assert.equal(actorHistory.rows[0].n,2);
  }finally{
    await scoped.end();await owner.end();
    await admin.query('DROP DATABASE IF EXISTS "'+db+'"');
    await admin.query('DROP ROLE IF EXISTS "'+role+'"');
    await admin.end();
  }
});
