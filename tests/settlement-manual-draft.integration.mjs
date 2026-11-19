import {test} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import pg from "pg";

test("OPEN manual draft edit/cancel is audited, non-overlapping and ledger-neutral",async()=>{
  if(!process.env.DATABASE_URL)throw Error("Requires isolated migrated PG17");
  const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:1});
  const c=await pool.connect();
  const owner=randomUUID(),group=randomUUID(),schedule=randomUUID();
  const first=randomUUID(),second=randomUUID(),replacement=randomUUID();
  const insert="INSERT INTO group_settlement_cycles "+
    "(id,group_id,schedule_revision_id,source,period_start,period_end,"+
    "time_zone,start_at,end_at,created_by,request_key) "+
    "VALUES($1,$2,$3,'manual',$4::date,$5::date,'UTC',"+
    "$4::date::timestamptz,$5::date::timestamptz,$6,$7)";
  const args=(id,start,end)=>[id,group,schedule,start,end,owner,randomUUID()];
  async function reject(sql,args,expected){
    await c.query("SAVEPOINT invalid");
    try{await assert.rejects(c.query(sql,args),e=>
      expected.startsWith("23")?e.code===expected:
        typeof e.message==="string"&&e.message.includes(expected));}
    finally{await c.query("ROLLBACK TO SAVEPOINT invalid");
      await c.query("RELEASE SAVEPOINT invalid");}
  }
  try{
    await c.query("BEGIN");
    await c.query('INSERT INTO "user"(id,name,email) VALUES($1,$2,$3)',
      [owner,"Manual draft owner","manual-"+owner+"@example.test"]);
    await c.query("INSERT INTO groups(id,owner_id,name) VALUES($1,$2,'Manual draft test')",
      [group,owner]);
    await c.query("INSERT INTO group_members(group_id,user_id,role) VALUES($1,$2,'owner')",
      [group,owner]);
    await c.query("INSERT INTO group_settlement_schedule_heads(group_id,updated_by) VALUES($1,$2)",
      [group,owner]);
    await c.query("INSERT INTO group_settlement_schedule_revisions "+
      "(id,group_id,version,frequency,time_zone,anchor_date,effective_at,created_by) "+
      "VALUES($1,$2,1,'manual','UTC','2026-01-01','2026-01-01T00:00:00Z',$3)",
      [schedule,group,owner]);
    await c.query(insert,args(first,"2026-09-01","2026-09-08"));
    await c.query(insert,args(second,"2026-09-08","2026-09-15"));
    await reject("UPDATE group_settlement_cycles SET period_end='2026-09-09' WHERE id=$1",
      [first],"Invalid cycle state transition");
    await reject("UPDATE group_settlement_cycles SET "+
      "period_start='2026-09-07',start_at='2026-09-07T00:00:00Z',"+
      "draft_revision=draft_revision+1,updated_at=clock_timestamp() WHERE id=$1",
      [second],"23P01");
    const changed=await c.query("UPDATE group_settlement_cycles SET "+
      "period_start='2026-08-30',period_end='2026-09-08',"+
      "start_at='2026-08-30T00:00:00Z',end_at='2026-09-08T00:00:00Z',"+
      "draft_revision=draft_revision+1,updated_at=clock_timestamp() "+
      "WHERE id=$1 RETURNING version,draft_revision,state,period_start::text AS start",
      [first]);
    assert.deepEqual(changed.rows[0],
      {version:1,draft_revision:1,state:"open",start:"2026-08-30"});
    const eid=randomUUID();
    await c.query("INSERT INTO group_settlement_cycle_draft_events "+
      "(id,group_id,cycle_id,draft_revision,actor_id,event_type,"+
      "old_period_start,old_period_end,new_period_start,new_period_end) "+
      "VALUES($1,$2,$3,1,$4,'period_updated','2026-09-01','2026-09-08',"+
      "'2026-08-30','2026-09-08')",[eid,group,first,owner]);
    await reject("UPDATE group_settlement_cycle_draft_events "+
      "SET new_period_end='2026-09-09' WHERE id=$1",[eid],"append-only");
    const canceled=await c.query("UPDATE group_settlement_cycles SET "+
      "cancelled_at=clock_timestamp(),cancelled_by=$2,"+
      "draft_revision=draft_revision+1,updated_at=clock_timestamp() "+
      "WHERE id=$1 RETURNING draft_revision,cancelled_at",[first,owner]);
    assert.equal(canceled.rows[0].draft_revision,2);
    assert.ok(canceled.rows[0].cancelled_at);
    await reject("UPDATE group_settlement_cycles SET cancelled_at=NULL,"+
      "cancelled_by=NULL,draft_revision=draft_revision+1 WHERE id=$1",
      [first],"A cancelled cycle is immutable");
    await reject("DELETE FROM group_settlement_cycles WHERE id=$1",[first],
      "Settlement cycles cannot be deleted");
    await c.query(insert,args(replacement,"2026-08-30","2026-09-08"));
    const reviewed=await c.query("UPDATE group_settlement_cycles SET "+
      "state='review',version=version+1,reviewed_at=clock_timestamp(),"+
      "updated_at=clock_timestamp() WHERE id=$1 RETURNING version,state",[second]);
    assert.deepEqual(reviewed.rows[0],{version:2,state:"review"});
    await reject("UPDATE group_settlement_cycles SET "+
      "cancelled_at=clock_timestamp(),cancelled_by=$2,"+
      "draft_revision=draft_revision+1,updated_at=clock_timestamp() WHERE id=$1",
      [second,owner],"Invalid cycle state transition");
    await reject("UPDATE group_settlement_cycles SET "+
      "period_end='2026-09-16',end_at='2026-09-16T00:00:00Z',"+
      "draft_revision=draft_revision+1,updated_at=clock_timestamp() WHERE id=$1",
      [second],"Invalid cycle state transition");
    const visible=await c.query("SELECT count(*)::int AS n "+
      "FROM group_settlement_cycles WHERE group_id=$1 AND cancelled_at IS NULL",[group]);
    assert.equal(visible.rows[0].n,2);
    for(const table of ["expenses","obligations","settlements","settlement_allocations"]){
      const count=await c.query("SELECT count(*)::int AS n FROM "+
        table+" WHERE group_id=$1",[group]);
      assert.equal(count.rows[0].n,0);
    }
  }finally{await c.query("ROLLBACK");c.release();await pool.end();}
});
