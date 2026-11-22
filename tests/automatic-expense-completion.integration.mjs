import {test} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import pg from "pg";

/** Exercises the upgraded audit constraint with a disposable transaction.
 * No production data is modified and all fixture rows are rolled back.
 */
test("migration 029 records automatic completion without forging a creator action",async()=>{
  if(!process.env.DATABASE_URL)throw Error("Requires disposable PostgreSQL DB");
  const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:1});
  const c=await pool.connect();
  const creator=randomUUID(),trigger=randomUUID(),group=randomUUID(),invoice=randomUUID();
  try{
    await c.query("BEGIN");
    for(const actor of [creator,trigger]){
      await c.query('INSERT INTO "user"(id,name,email) VALUES($1,$2,$3)',
        [actor,"Auto-completion fixture",actor+"@example.test"]);
    }
    await c.query("INSERT INTO groups(id,owner_id,name) VALUES($1,$2,'Auto-close fixture')",
      [group,creator]);
    await c.query("INSERT INTO group_members(group_id,user_id,role) VALUES($1,$2,'owner')",
      [group,creator]);
    await c.query("INSERT INTO group_members(group_id,user_id,role) VALUES($1,$2,'member')",
      [group,trigger]);
    await c.query(`INSERT INTO expenses
      (id,group_id,payer_id,created_by,title,occurred_on,total_minor)
      VALUES($1,$2,$3,$3,'Ready zero-obligation invoice','2026-11-01',5000)`,
      [invoice,group,creator]);
    const updated=await c.query(`UPDATE expenses
      SET completed_at=now(),completed_by=created_by,version=version+1
      WHERE id=$1 AND group_id=$2 AND completed_at IS NULL RETURNING version`,
      [invoice,group]);
    assert.equal(updated.rowCount,1);
    await c.query(`INSERT INTO expense_completion_events
      (id,group_id,expense_id,actor_id,expense_version,origin,triggered_by)
      VALUES($1,$2,$3,NULL,$4,'automatic',$5)`,
      [randomUUID(),group,invoice,updated.rows[0].version,trigger]);
    const row=await c.query(`SELECT ev.origin,ev.actor_id,ev.triggered_by,
      e.completed_by,e.created_by FROM expense_completion_events ev
      JOIN expenses e ON e.id=ev.expense_id WHERE e.id=$1`,[invoice]);
    assert.deepEqual(row.rows.map(x=>({
      origin:x.origin,actorId:x.actor_id,triggeredBy:x.triggered_by,
      ownerPreserved:x.completed_by===x.created_by,
    })),[{origin:"automatic",actorId:null,triggeredBy:trigger,ownerPreserved:true}]);

    await c.query("SAVEPOINT invalid_audit");
    await assert.rejects(c.query(`INSERT INTO expense_completion_events
      (id,group_id,expense_id,actor_id,expense_version,origin,triggered_by)
      VALUES($1,$2,$3,NULL,2,'manual',NULL)`,
      [randomUUID(),group,randomUUID()]),e=>e.code==="23514");
    await c.query("ROLLBACK TO SAVEPOINT invalid_audit");
    await c.query("RELEASE SAVEPOINT invalid_audit");
  }finally{
    await c.query("ROLLBACK").catch(()=>{});
    c.release();
    await pool.end();
  }
});
