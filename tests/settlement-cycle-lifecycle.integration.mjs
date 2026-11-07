import {test} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import pg from "pg";

test("SC-003 isolated SQL: no overlapping cycles, immutable identity, legal transition and audit",async()=>{
  if(!process.env.DATABASE_URL)throw Error("Requires isolated PostgreSQL database");
  const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:1});
  const c=await pool.connect();
  const user=randomUUID(),group=randomUUID(),revision=randomUUID();
  const cycleA=randomUUID(),cycleB=randomUUID(),key=randomUUID();
  async function reject(sql,params,codeOrText) {
    await c.query("SAVEPOINT sc003_neg");
    try{
      await assert.rejects(c.query(sql,params),e=>
        codeOrText?.startsWith("23") ? e.code===codeOrText
          : typeof e.message==="string"&&e.message.includes(codeOrText));
    }finally{
      await c.query("ROLLBACK TO SAVEPOINT sc003_neg");
      await c.query("RELEASE SAVEPOINT sc003_neg");
    }
  }
  const insert=`INSERT INTO group_settlement_cycles
     (id,group_id,schedule_revision_id,source,period_start,period_end,
      time_zone,start_at,end_at,created_by,request_key)
      VALUES($1,$2,$3,$4,$5,$6,'UTC',$7,$8,$9,$10)`;
  const manual=(id,start,end,startAt,endAt,requestKey=randomUUID())=>
    [id,group,revision,"manual",start,end,startAt,endAt,user,requestKey];
  try{
    await c.query("BEGIN");
    await c.query('INSERT INTO "user"(id,name,email) VALUES($1,$2,$3)',
      [user,"SC003 owner",`sc003-${user}@example.test`]);
    await c.query("INSERT INTO groups(id,owner_id,name) VALUES($1,$2,'Cycle SQL test')",
      [group,user]);
    await c.query("INSERT INTO group_members(group_id,user_id,role) VALUES($1,$2,'owner')",
      [group,user]);
    await c.query("INSERT INTO group_settlement_schedule_heads(group_id,updated_by) VALUES($1,$2)",
      [group,user]);
    await c.query(`INSERT INTO group_settlement_schedule_revisions
      (id,group_id,version,frequency,time_zone,anchor_date,effective_at,created_by)
      VALUES($1,$2,1,'manual','UTC','2025-01-01','2025-01-01T00:00:00Z',$3)`,
      [revision,group,user]);
    const first=manual(cycleA,"2026-10-01","2026-10-08",
      "2026-10-01T00:00:00Z","2026-10-08T00:00:00Z",key);
    await c.query(insert,first);
    await reject(insert,manual(randomUUID(),"2026-10-07","2026-10-10",
      "2026-10-07T00:00:00Z","2026-10-10T00:00:00Z"),"23P01");
    await reject(insert,manual(randomUUID(),"2026-10-02","2026-10-06",
      "2026-10-02T00:00:00Z","2026-10-06T00:00:00Z"),"23P01");
    // Adjacent [end,start) does NOT overlap.
    await c.query(insert,manual(cycleB,"2026-10-08","2026-10-15",
      "2026-10-08T00:00:00Z","2026-10-15T00:00:00Z"));
    await reject(insert,manual(randomUUID(),"2026-10-15","2026-10-12",
      "2026-10-15T00:00:00Z","2026-10-12T00:00:00Z"),"23514");
    await reject(insert,manual(randomUUID(),"2026-10-16","2026-10-17",
      "2026-10-16T00:00:00Z","2026-10-17T00:00:00Z",key),"23505");
    await reject(insert,
      [randomUUID(),randomUUID(),revision,"manual","2026-11-01","2026-11-03",
       "2026-11-01T00:00:00Z","2026-11-03T00:00:00Z",user,randomUUID()],
      "23503");
    await reject(insert,
      [randomUUID(),group,revision,"manual","2026-11-01","2026-11-03",
       "2026-11-01T00:00:00Z","2026-11-03T00:00:00Z",null,randomUUID()],
      "23514");
    await reject("UPDATE group_settlement_cycles SET period_end='2026-10-09' WHERE id=$1",
      [cycleA],"Invalid cycle state transition");
    await reject("DELETE FROM group_settlement_cycles WHERE id=$1",
      [cycleA],"Settlement cycles cannot be deleted");
    await reject("UPDATE group_settlement_cycles SET state='review',version=2,reviewed_at='2026-10-01T00:00:00Z' WHERE id=$1",
      [cycleB],"Invalid cycle state transition");
    const reviewed=await c.query(
      `UPDATE group_settlement_cycles SET state='review',version=version+1,
       reviewed_at=clock_timestamp(),updated_at=clock_timestamp()
       WHERE id=$1 RETURNING state,version`,
      [cycleA]);
    assert.deepEqual(reviewed.rows[0],{state:"review",version:2});
    await reject("UPDATE group_settlement_cycles SET state='open',version=3,reviewed_at=NULL WHERE id=$1",
      [cycleA],"Invalid cycle state transition");
    await reject("UPDATE group_settlement_cycles SET state='locked',version=3 WHERE id=$1",
      [cycleA],"Invalid cycle state transition");

    const evt=randomUUID();
    await c.query(`INSERT INTO group_settlement_cycle_events
      (id,group_id,cycle_id,event_type,initiator,actor_id,
       from_state,to_state,cycle_version,details)
      VALUES($1,$2,$3,'created','member',$4,NULL,'open',1,'{}')`,
      [evt,group,cycleA,user]);
    await reject(`INSERT INTO group_settlement_cycle_events
      (id,group_id,cycle_id,event_type,initiator,actor_id,
       from_state,to_state,cycle_version,details)
      VALUES($1,$2,$3,'created','member',$4,NULL,'open',1,'{}')`,
      [randomUUID(),group,cycleA,user],"23505");
    await reject("UPDATE group_settlement_cycle_events SET details='{}'::jsonb WHERE id=$1",
      [evt],"append-only");
    await reject("DELETE FROM group_settlement_cycle_events WHERE id=$1",
      [evt],"append-only");

    const overlaps=await c.query(
      "SELECT count(*)::int AS n FROM group_settlement_cycles WHERE group_id=$1",
      [group]);
    assert.equal(overlaps.rows[0].n,2);
    for(const table of ["expenses","obligations","settlements","settlement_allocations"]){
      assert.equal((await c.query(`SELECT count(*)::int AS n FROM ${table} WHERE group_id=$1`,
        [group])).rows[0].n,0);
    }
  }finally{
    await c.query("ROLLBACK");
    c.release();
    await pool.end();
  }
});
