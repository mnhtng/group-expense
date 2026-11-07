import {test} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import pg from "pg";

test("SC-002 SQL schedule revisions are constrained, immutable and ledger-neutral",async()=>{
  if(!process.env.DATABASE_URL)throw Error("Requires isolated PostgreSQL test DB");
  const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:1});
  const client=await pool.connect();
  const owner=randomUUID(),group=randomUUID(),id=randomUUID();
  async function bad(query,params,code) {
    await client.query("SAVEPOINT sc002_invalid");
    try{
      await assert.rejects(client.query(query,params),
        e=>code?e.code===code:/Schedule revisions|append-only|Only an unactivated/.test(e.message));
    }finally{
      await client.query("ROLLBACK TO SAVEPOINT sc002_invalid");
      await client.query("RELEASE SAVEPOINT sc002_invalid");
    }
  }
  try{
    await client.query("BEGIN");
    await client.query('INSERT INTO "user"(id,name,email) VALUES($1,$2,$3)',
      [owner,"SC002 owner",`sc002-${owner}@example.test`]);
    await client.query("INSERT INTO groups(id,owner_id,name) VALUES($1,$2,$3)",
      [group,owner,"Schedule test"]);
    await client.query("INSERT INTO group_members(group_id,user_id,role) VALUES($1,$2,'owner')",
      [group,owner]);

    for(const table of ["group_settlement_schedule_heads","group_settlement_schedule_revisions",
      "group_settlement_schedule_events"]){
      const r=await client.query(`SELECT count(*)::int AS n FROM ${table} WHERE group_id=$1`,[group]);
      assert.equal(r.rows[0].n,0,table+" must be absent for default-OFF groups");
    }
    await client.query(
      "INSERT INTO group_settlement_schedule_heads(group_id,updated_by) VALUES($1,$2)",
      [group,owner],
    );
    await bad("UPDATE group_settlement_schedule_heads SET version=0 WHERE group_id=$1",
      [group],"23514");

    const insert=`INSERT INTO group_settlement_schedule_revisions
      (id,group_id,version,frequency,time_zone,anchor_date,effective_at,created_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8)`;
    const cutover="2090-12-06T17:00:00.000Z";
    const params=[id,group,1,"weekly","Asia/Ho_Chi_Minh","2090-12-07",cutover,owner];
    await client.query(insert,params);
    await bad(insert,[randomUUID(),group,1,"weekly","Asia/Ho_Chi_Minh",
      "2090-12-07","2090-12-13T17:00:00.000Z",owner],"23505");
    await bad(insert,[randomUUID(),group,2,"weekly","Asia/Ho_Chi_Minh",
      "2090-12-07",cutover,owner],"23505");
    await bad(insert,[randomUUID(),group,2,"daily","Asia/Ho_Chi_Minh",
      "2090-12-14","2090-12-13T17:00:00.000Z",owner],"23514");
    await bad(insert,[randomUUID(),group,2,"weekly","",
      "2090-12-14","2090-12-13T17:00:00.000Z",owner],"23514");
    await bad(insert,[randomUUID(),randomUUID(),2,"weekly","UTC",
      "2090-12-14","2090-12-14T00:00:00.000Z",owner],"23503");
    await bad("UPDATE group_settlement_schedule_revisions SET anchor_date='2090-12-08' WHERE id=$1",
      [id],null);
    await bad("DELETE FROM group_settlement_schedule_revisions WHERE id=$1",
      [id],null);

    const eventId=randomUUID();
    await client.query(`INSERT INTO group_settlement_schedule_events
      (id,group_id,schedule_revision_id,actor_id,event_type,details)
      VALUES($1,$2,$3,$4,$5,$6::jsonb)`,
      [eventId,group,id,owner,"schedule_created",JSON.stringify({frequency:"weekly"})]);
    await bad("UPDATE group_settlement_schedule_events SET details='{}'::jsonb WHERE id=$1",
      [eventId],null);
    await bad("DELETE FROM group_settlement_schedule_events WHERE id=$1",[eventId],null);

    // Retire an unactivated plan, preserve it in history, and install a newer
    // immutable revision for the same instant.
    await client.query(
      "UPDATE group_settlement_schedule_revisions SET superseded_at=now() WHERE id=$1",[id]);
    await bad(
      "UPDATE group_settlement_schedule_revisions SET superseded_at=now() WHERE id=$1",
      [id],null);
    await client.query(insert,[randomUUID(),group,2,"biweekly","Asia/Ho_Chi_Minh",
      "2090-12-07",cutover,owner]);
    const state=await client.query(
      `SELECT count(*)::int AS all_revisions,
        count(*) FILTER(WHERE superseded_at IS NULL)::int AS active_revisions
       FROM group_settlement_schedule_revisions WHERE group_id=$1`,[group]);
    assert.deepEqual(state.rows[0],{all_revisions:2,active_revisions:1});

    for(const name of ["expenses","obligations","settlements","settlement_allocations"]){
      const r=await client.query(`SELECT count(*)::int AS n FROM ${name} WHERE group_id=$1`,
        [group]);
      assert.equal(r.rows[0].n,0,name+" cannot be affected by schedule setup");
    }
  }finally{
    await client.query("ROLLBACK");
    client.release();
    await pool.end();
  }
});
