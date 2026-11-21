import {test} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {spawnSync} from "node:child_process";
import pg from "pg";

const base="postgresql://test:test@localhost:5432/group_expense";

test("SC028 group-specific Financial Engine, independent emergency pause, safe default and constraints",
  {timeout:30000},async()=>{
  assert.equal(process.env.CI,"true");
  assert.equal(process.env.DATABASE_URL,base);
  const suffix=randomUUID().replaceAll("-","");
  const db="group_expense_sc028_"+suffix;
  const admin=new pg.Pool({connectionString:base,max:1});
  const owner=new pg.Pool({connectionString:base.replace(/group_expense$/,db),max:3});
  const actor=randomUUID(),groupA=randomUUID(),groupB=randomUUID();
  try{
    await admin.query('CREATE DATABASE "'+db+'"');
    const run=spawnSync(process.execPath,["db/migrate.mjs"],{
      env:{...process.env,DATABASE_URL:base.replace(/group_expense$/,db),DATABASE_URL_DIRECT:""},
      encoding:"utf8",timeout:30000});
    assert.equal(run.status,0,run.stderr);
    assert.equal((await owner.query("SELECT COUNT(*)::int AS n FROM schema_migrations")).rows[0].n,30);

    await owner.query('INSERT INTO "user"(id,name,email) VALUES($1,$2,$3)',
      [actor,"SC028 group owner",actor+"@example.test"]);
    for(const g of [groupA,groupB]){
      await owner.query("INSERT INTO groups(id,owner_id,name) VALUES($1,$2,$3)",
        [g,actor,"SC028 isolated group"]);
      await owner.query("INSERT INTO group_members(group_id,user_id,role) VALUES($1,$2,'owner')",
        [g,actor]);
      await owner.query(`INSERT INTO group_settlement_settings
        (group_id,requested_enabled,requested_bilateral_netting,updated_by)
        VALUES($1,true,true,$2)`,[g,actor]);
    }
    const state=async(g)=> (await owner.query(`SELECT p.emergency_paused,
        s.requested_enabled,s.financial_engine_enabled,s.requested_bilateral_netting,
        p.enabled AS "legacyGlobal",COALESCE(c.admitted,false) AS "legacyEnrolled"
      FROM group_settlement_settings s CROSS JOIN settlement_cycle_engine_control p
      LEFT JOIN settlement_cycle_engine_cohort c ON c.group_id=s.group_id
      WHERE p.id=1 AND s.group_id=$1`,[g])).rows[0];
    const canFinance=async(g)=>{const v=await state(g);
      return !v.emergency_paused&&v.requested_enabled&&v.financial_engine_enabled};
    assert.equal(await canFinance(groupA),false,"all existing groups start disabled");
    assert.equal(await canFinance(groupB),false);
    assert.equal((await state(groupA)).legacyGlobal,false);
    assert.equal((await state(groupA)).legacyEnrolled,false);

    await owner.query("UPDATE group_settlement_settings SET financial_engine_enabled=true WHERE group_id=$1",[groupA]);
    assert.equal(await canFinance(groupA),true,
      "group A may turn on regardless of legacy global OFF and empty cohort");
    assert.equal(await canFinance(groupB),false,"group B remains independently disabled");
    assert.equal((await state(groupA)).legacyGlobal,false,"must not toggle legacy global");

    await owner.query("UPDATE settlement_cycle_engine_control SET emergency_paused=true WHERE id=1");
    assert.equal(await canFinance(groupA),false,"emergency stop blocks active group");
    assert.equal(await canFinance(groupB),false);
    await owner.query("UPDATE settlement_cycle_engine_control SET emergency_paused=false WHERE id=1");
    assert.equal(await canFinance(groupA),true,"emergency resume restores opted-in group");

    await assert.rejects(
      owner.query("UPDATE group_settlement_settings SET requested_enabled=false WHERE group_id=$1",[groupA]),
      e=>e.code==="23514");
    await owner.query(`UPDATE group_settlement_settings
      SET requested_enabled=false,requested_bilateral_netting=false,
          financial_engine_enabled=false WHERE group_id=$1`,[groupA]);
    assert.equal(await canFinance(groupA),false,
      "disabling settlement also revokes financial engine");
    await owner.query("UPDATE group_settlement_settings SET requested_enabled=true WHERE group_id=$1",[groupA]);
    assert.equal(await canFinance(groupA),false,
      "re-enabling settlement cannot silently reenable financial writes");

    const original=await owner.query(`SELECT
      (SELECT COUNT(*)::int FROM expenses) AS expenses,
      (SELECT COUNT(*)::int FROM obligations) AS obligations,
      (SELECT COUNT(*)::int FROM settlements) AS settlements,
      (SELECT COUNT(*)::int FROM settlement_allocations) AS allocations,
      (SELECT COUNT(*)::int FROM settlement_cycle_engine_cohort) AS cohorts`);
    assert.deepEqual(original.rows[0],
      {expenses:0,obligations:0,settlements:0,allocations:0,cohorts:0},
      "financial history and old cohort remain unchanged");
    const trigger=await owner.query(`SELECT count(*)::int AS n FROM pg_trigger
      WHERE tgrelid='settlement_cycle_engine_control'::regclass
      AND tgname IN('sc025_control_guard','sc025_control_audit') AND tgenabled IN('O','A')`);
    assert.equal(trigger.rows[0].n,2,"emergency stop still has guard and audit");
    const history=await owner.query("SELECT count(*)::int AS n FROM settlement_cycle_engine_events WHERE subject='control'");
    assert.equal(history.rows[0].n,2,"operator emergency pause/resume is audited");
  }finally{
    await owner.end();
    await admin.query('DROP DATABASE IF EXISTS "'+db+'"');
    await admin.end();
  }
});
