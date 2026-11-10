import {test} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import pg from "pg";

test("SC-001 isolated SQL constraints, default-OFF and no ledger changes",async()=>{
  if(!process.env.DATABASE_URL)throw Error("DATABASE_URL is required");
  const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:1});
  const c=await pool.connect();
  const userId=randomUUID(),otherId=randomUUID(),groupId=randomUUID();
  const bad=async(statement,args,code)=>{
    await c.query("SAVEPOINT validate_constraints");
    try{
      await assert.rejects(c.query(statement,args),err=>err.code===code);
    }finally{await c.query("ROLLBACK TO SAVEPOINT validate_constraints");
      await c.query("RELEASE SAVEPOINT validate_constraints");}
  };
  try{
    await c.query("BEGIN");
    for(const id of [userId,otherId]){
      await c.query('INSERT INTO "user"(id,name,email) VALUES($1,$2,$3)',
        [id,"Settlement tester",`cycle-${id}@example.test`]);
    }
    await c.query("INSERT INTO groups(id,owner_id,name) VALUES($1,$2,'Default-off group')",
      [groupId,userId]);
    await c.query("INSERT INTO group_members(group_id,user_id,role) VALUES($1,$2,'owner')",
      [groupId,userId]);
    await c.query("INSERT INTO group_members(group_id,user_id,role) VALUES($1,$2,'member')",
      [groupId,otherId]);

    assert.equal((await c.query(
      "SELECT count(*)::int AS n FROM group_settlement_settings WHERE group_id=$1",
      [groupId])).rows[0].n,0,"legacy/new groups must have no feature config row");

    const settings=await c.query(`INSERT INTO group_settlement_settings
      (group_id,updated_by) VALUES($1,$2)
      RETURNING requested_enabled,requested_bilateral_netting,version`,
      [groupId,userId]);
    assert.deepEqual(settings.rows[0],{
      requested_enabled:false,requested_bilateral_netting:false,version:1,
    });
    await bad("UPDATE group_settlement_settings SET requested_bilateral_netting=true WHERE group_id=$1",
      [groupId],"23514");
    await bad("UPDATE group_settlement_settings SET version=0 WHERE group_id=$1",
      [groupId],"23514");
    await c.query(`UPDATE group_settlement_settings
      SET requested_enabled=true,requested_bilateral_netting=true WHERE group_id=$1`,[groupId]);

    const grantId=randomUUID();
    await c.query(`INSERT INTO group_settlement_manager_grants
      (id,group_id,user_id,granted_by) VALUES($1,$2,$3,$4)`,
      [grantId,groupId,otherId,userId]);
    await bad(`INSERT INTO group_settlement_manager_grants
      (id,group_id,user_id,granted_by) VALUES($1,$2,$3,$4)`,
      [randomUUID(),groupId,otherId,userId],"23505");
    await bad(`INSERT INTO group_settlement_manager_grants
      (id,group_id,user_id,granted_by) VALUES($1,$2,$3,$4)`,
      [randomUUID(),groupId,randomUUID(),userId],"23503");
    await bad(`UPDATE group_settlement_manager_grants SET revoked_at=now()
      WHERE id=$1`,[grantId],"23514");
    await c.query(`UPDATE group_settlement_manager_grants
      SET revoked_at=now(),revoked_by=$2 WHERE id=$1`,[grantId,userId]);
    await c.query(`INSERT INTO group_settlement_manager_grants
      (id,group_id,user_id,granted_by) VALUES($1,$2,$3,$4)`,
      [randomUUID(),groupId,otherId,userId]);
    await c.query(`INSERT INTO group_settlement_config_events
      (id,group_id,actor_id,subject_user_id,event_type,details)
      VALUES($1,$2,$3,$4,'manager_granted',$5::jsonb)`,
      [randomUUID(),groupId,userId,otherId,JSON.stringify({reason:"test"})]);
    assert.equal((await c.query(
      "SELECT count(*)::int AS n FROM group_settlement_config_events WHERE group_id=$1",
      [groupId])).rows[0].n,1);

    for(const table of ["expenses","obligations","settlements","settlement_allocations"]){
      const check=await c.query(`SELECT count(*)::int AS n FROM ${table} WHERE group_id=$1`,
        [groupId]);
      assert.equal(check.rows[0].n,0,`${table} must be untouched by settings`);
    }
  }finally{
    await c.query("ROLLBACK");
    c.release();
    await pool.end();
  }
});
