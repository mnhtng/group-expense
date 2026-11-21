import {test} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import pg from "pg";

test("SC031: immutable locked snapshot plus separate exactly-once completion",async()=>{
  if(!process.env.DATABASE_URL)throw Error("Requires disposable PostgreSQL database");
  const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:1});
  const c=await pool.connect();
  const actor=randomUUID(),group=randomUUID(),schedule=randomUUID(),cycle=randomUUID();
  async function rejects(sql,args=[],code="23514"){
    await c.query("SAVEPOINT sc031_invalid");
    try{
      await assert.rejects(c.query(sql,args),e=>e.code===code);
    }finally{
      await c.query("ROLLBACK TO SAVEPOINT sc031_invalid");
      await c.query("RELEASE SAVEPOINT sc031_invalid");
    }
  }
  try{
    await c.query("BEGIN");
    await c.query('INSERT INTO "user"(id,name,email) VALUES($1,$2,$3)',
      [actor,"SC031 actor",actor+"@example.test"]);
    await c.query("INSERT INTO groups(id,owner_id,name) VALUES($1,$2,'SC031 fixture')",
      [group,actor]);
    await c.query("INSERT INTO group_members(group_id,user_id,role) VALUES($1,$2,'owner')",
      [group,actor]);
    await c.query("INSERT INTO group_settlement_schedule_heads(group_id,updated_by) VALUES($1,$2)",
      [group,actor]);
    await c.query(`INSERT INTO group_settlement_schedule_revisions
      (id,group_id,version,frequency,time_zone,anchor_date,effective_at,created_by)
      VALUES($1,$2,1,'manual','UTC','2026-08-01','2026-08-01T00:00:00Z',$3)`,
      [schedule,group,actor]);
    await c.query(`INSERT INTO group_settlement_cycles
      (id,group_id,schedule_revision_id,source,period_start,period_end,
       time_zone,start_at,end_at,created_by,request_key)
      VALUES($1,$2,$3,'manual','2026-08-01','2026-08-08','UTC',
       '2026-08-01T00:00:00Z','2026-08-08T00:00:00Z',$4,$5)`,
      [cycle,group,schedule,actor,randomUUID()]);
    await c.query(`UPDATE group_settlement_cycles
      SET state='review',version=2,reviewed_at=clock_timestamp(),
      updated_at=clock_timestamp() WHERE id=$1`,[cycle]);
    assert.equal((await c.query("SELECT sc031_cycle_ready($1,$2) AS ready",
      [group,cycle])).rows[0].ready,false);
    await rejects(`INSERT INTO group_settlement_cycle_completions
      (cycle_id,group_id,origin,triggered_by)
      VALUES($1,$2,'automatic',$3)`,[cycle,group,actor]);

    await c.query(`INSERT INTO group_settlement_cycle_snapshots
      (cycle_id,group_id,request_key,locked_by,cutoff_at,
      expense_count,obligation_count,original_minor,confirmed_cash_minor,
      pending_cash_minor,outstanding_minor,available_minor,fingerprint)
      VALUES($1,$2,$3,$4,clock_timestamp(),0,0,0,0,0,0,0,$5)`,
      [cycle,group,randomUUID(),actor,"a".repeat(64)]);
    await c.query(`UPDATE group_settlement_cycles SET state='locked',version=3,
      locked_at=clock_timestamp(),locked_by=$2,updated_at=clock_timestamp()
      WHERE id=$1`,[cycle,actor]);
    assert.equal((await c.query("SELECT sc031_cycle_ready($1,$2) AS ready",
      [group,cycle])).rows[0].ready,true);
    const completed=await c.query(`INSERT INTO group_settlement_cycle_completions
      (cycle_id,group_id,origin,triggered_by)
      VALUES($1,$2,'automatic',$3) RETURNING origin,triggered_by`,
      [cycle,group,actor]);
    assert.deepEqual(completed.rows,[{origin:"automatic",triggered_by:actor}]);
    const repeat=await c.query(`INSERT INTO group_settlement_cycle_completions
      (cycle_id,group_id,origin,triggered_by)
      VALUES($1,$2,'automatic',$3)
      ON CONFLICT(cycle_id) DO NOTHING RETURNING cycle_id`,
      [cycle,group,actor]);
    assert.equal(repeat.rowCount,0,"only one completion proof per cycle");
    assert.deepEqual((await c.query(`SELECT state,version FROM group_settlement_cycles
      WHERE id=$1`,[cycle])).rows,[{state:"locked",version:3}],
      "snapshot state and version must never change");
    await rejects("UPDATE group_settlement_cycle_completions SET completed_at=now() WHERE cycle_id=$1",
      [cycle]);
    await rejects("DELETE FROM group_settlement_cycle_completions WHERE cycle_id=$1",
      [cycle]);
    await rejects("TRUNCATE group_settlement_cycle_completions");
    assert.equal((await c.query(`SELECT count(*)::int AS n
      FROM group_settlement_cycle_completions WHERE cycle_id=$1`,[cycle])).rows[0].n,1);
  }finally{
    await c.query("ROLLBACK").catch(()=>{});
    c.release();
    await pool.end();
  }
});
