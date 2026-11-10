import {test} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import pg from "pg";

const url="postgresql://test:test@localhost:5432/group_expense";
test("RR-004 legacy audit rejects UPDATE, DELETE and TRUNCATE without losing source history",async()=>{
  assert.equal(process.env.CI,"true");
  assert.equal(process.env.DATABASE_URL,url);
  const pool=new pg.Pool({connectionString:url,max:1});
  const c=await pool.connect();
  const owner=randomUUID(),other=randomUUID(),group=randomUUID(),bill=randomUUID(),cash=randomUUID();
  try{
    await c.query("BEGIN");
    for(const id of [owner,other])await c.query('INSERT INTO "user"(id,name,email) VALUES($1,$1,$2)',[id,id+"@example.test"]);
    await c.query("INSERT INTO groups(id,owner_id,name) VALUES($1,$2,'RR004 synthetic audit')",[group,owner]);
    await c.query("INSERT INTO group_members(group_id,user_id,role) VALUES($1,$2,'owner'),($1,$3,'member')",[group,owner,other]);
    await c.query(`INSERT INTO expenses(id,group_id,payer_id,created_by,title,total_minor)
      VALUES($1,$2,$3,$3,'RR004 synthetic source',100)`,[bill,group,owner]);
    await c.query(`INSERT INTO settlements(id,group_id,debtor_id,creditor_id,initiated_by,amount_minor,request_key,request_fingerprint)
      VALUES($1,$2,$3,$4,$3,100,$5,$6)`,[cash,group,other,owner,randomUUID(),"a".repeat(64)]);
    const tables=[
      ["expense_events",`INSERT INTO expense_events(id,group_id,expense_id,actor_id,operation,version,snapshot)
        VALUES($1,$2,$3,$4,'created',1,'{}')`,[randomUUID(),group,bill,owner]],
      ["expense_completion_events",`INSERT INTO expense_completion_events(id,group_id,expense_id,actor_id,expense_version)
        VALUES($1,$2,$3,$4,1)`,[randomUUID(),group,bill,owner]],
      ["settlement_events",`INSERT INTO settlement_events(id,settlement_id,actor_id,event_type)
        VALUES($1,$2,$3,'created')`,[randomUUID(),cash,other]],
      ["group_membership_events",`INSERT INTO group_membership_events(id,group_id,user_id,actor_id,kind)
        VALUES($1,$2,$3,$3,'rejoined')`,[randomUUID(),group,owner]],
      ["group_note_events",`INSERT INTO group_note_events(id,group_id,actor_id,event_type)
        VALUES($1,$2,$3,'created')`,[randomUUID(),group,owner]],
      ["group_settlement_config_events",`INSERT INTO group_settlement_config_events(id,group_id,actor_id,event_type)
        VALUES($1,$2,$3,'settings_changed')`,[randomUUID(),group,owner]],
    ];
    for(const [table,insert,params] of tables){
      await c.query(insert,params);
      const before=(await c.query(`SELECT to_jsonb(t)::text AS data FROM ${table} t WHERE id=$1`,[params[0]])).rows;
      for(const sql of [
        `UPDATE ${table} SET recorded_at=recorded_at+interval '1 microsecond' WHERE id=$1`,
        `DELETE FROM ${table} WHERE id=$1`,
        `TRUNCATE ${table}`,
      ]){
        await c.query("SAVEPOINT forbidden_mutation");
        await assert.rejects(c.query(sql,sql.startsWith("TRUNCATE")?[]:[params[0]]),/RR-004 audit history is immutable/);
        await c.query("ROLLBACK TO SAVEPOINT forbidden_mutation");
      }
      assert.deepEqual((await c.query(`SELECT to_jsonb(t)::text AS data FROM ${table} t WHERE id=$1`,[params[0]])).rows,before);
    }
  }finally{
    await c.query("ROLLBACK");c.release();await pool.end();
  }
});
