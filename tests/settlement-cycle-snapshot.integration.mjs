import {test} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import pg from "pg";

test("SC-004 isolated PostgreSQL: immutable source snapshot, exact sums, lock guards, creator completion",async()=>{
  if(!process.env.DATABASE_URL)throw Error("Requires disposable PostgreSQL DB");
  const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:1});
  const c=await pool.connect();
  const owner=randomUUID(),debtor=randomUUID(),group=randomUUID(),rule=randomUUID();
  const cycle=randomUUID(),expense=randomUUID(),obligation=randomUUID();
  const asDate="2026-08-04",begin="2026-08-01",end="2026-08-08";
  async function fails(sql,args,expected){
    await c.query("SAVEPOINT invalid_sc004");
    try{
      await assert.rejects(c.query(sql,args),e=>
        expected.startsWith("23")?e.code===expected:
          typeof e.message==="string"&&e.message.includes(expected));
    }finally{
      await c.query("ROLLBACK TO SAVEPOINT invalid_sc004");
      await c.query("RELEASE SAVEPOINT invalid_sc004");
    }
  }
  const lockSql=`UPDATE group_settlement_cycles
    SET state='locked',version=3,locked_at=clock_timestamp(),
      locked_by=$2,updated_at=clock_timestamp()
    WHERE id=$1 RETURNING state,version`;
  const manifestSql=`INSERT INTO group_settlement_cycle_snapshots
    (cycle_id,group_id,request_key,locked_by,cutoff_at,
     expense_count,obligation_count,original_minor,
     confirmed_cash_minor,pending_cash_minor,outstanding_minor,available_minor,
     fingerprint)
    VALUES($1,$2,$3,$4,clock_timestamp(),1,1,$5,0,0,$5,$5,$6)`;
  try{
    await c.query("BEGIN");
    for(const id of [owner,debtor])
      await c.query('INSERT INTO "user"(id,name,email) VALUES($1,$2,$3)',
        [id,"Snapshot fixture",`sc004-${id}@example.test`]);
    await c.query("INSERT INTO groups(id,owner_id,name) VALUES($1,$2,'SC004 snapshot')",
      [group,owner]);
    await c.query("INSERT INTO group_members(group_id,user_id,role) VALUES($1,$2,'owner')",
      [group,owner]);
    await c.query("INSERT INTO group_members(group_id,user_id,role) VALUES($1,$2,'member')",
      [group,debtor]);
    await c.query("INSERT INTO group_settlement_schedule_heads(group_id,updated_by) VALUES($1,$2)",
      [group,owner]);
    await c.query(`INSERT INTO group_settlement_schedule_revisions
      (id,group_id,version,frequency,time_zone,anchor_date,effective_at,created_by)
      VALUES($1,$2,1,'manual','UTC',$3,$4,$5)`,
      [rule,group,begin,begin+"T00:00:00Z",owner]);
    await c.query(`INSERT INTO group_settlement_cycles
      (id,group_id,schedule_revision_id,source,period_start,period_end,
       time_zone,start_at,end_at,created_by,request_key)
      VALUES($1,$2,$3,'manual',$4,$5,'UTC',$6,$7,$8,$9)`,
      [cycle,group,rule,begin,end,begin+"T00:00:00Z",end+"T00:00:00Z",owner,randomUUID()]);
    await c.query(`UPDATE group_settlement_cycles
      SET state='review',version=2,reviewed_at=clock_timestamp(),
        updated_at=clock_timestamp() WHERE id=$1`,[cycle]);
    await fails(lockSql,[cycle,owner],"Invalid cycle state transition");

    await c.query(`INSERT INTO expenses
      (id,group_id,payer_id,created_by,title,occurred_on,total_minor)
      VALUES($1,$2,$3,$3,'Meal', $4, 10000)`,
      [expense,group,owner,asDate]);
    await c.query(`INSERT INTO obligations
      (id,group_id,expense_id,expense_version,debtor_id,creditor_id,amount_minor)
      VALUES($1,$2,$3,1,$4,$5,10000)`,
      [obligation,group,expense,debtor,owner]);
    const item=randomUUID();
    await c.query(`INSERT INTO expense_items
      (id,expense_id,group_id,position,name,quantity,unit_price_minor,amount_minor)
      VALUES($1,$2,$3,0,'Food',1,10000,10000)`,[item,expense,group]);
    await c.query(`INSERT INTO expense_item_shares(item_id,group_id,user_id,amount_minor)
      VALUES($1,$2,$3,10000)`,[item,group,debtor]);

    await c.query(`INSERT INTO group_settlement_cycle_snapshot_expenses
      (cycle_id,group_id,expense_id,expense_version,occurred_on,
       created_at,payer_id,created_by,total_minor,completed_at)
      SELECT $1,e.group_id,e.id,e.version,e.occurred_on,e.created_at,
             e.payer_id,e.created_by,e.total_minor,e.completed_at
      FROM expenses e WHERE e.id=$2`,[cycle,expense]);

    const insertDebt=`INSERT INTO group_settlement_cycle_snapshot_obligations
      (cycle_id,group_id,obligation_id,expense_id,expense_version,
       debtor_id,creditor_id,original_minor,confirmed_cash_minor,
       pending_cash_minor,outstanding_minor,available_minor)
       VALUES($1,$2,$3,$4,1,$5,$6,10000,0,0,$7,$8)`;
    await fails(insertDebt,[cycle,group,obligation,expense,debtor,owner,9999,9999],"23514");
    await c.query(insertDebt,[cycle,group,obligation,expense,debtor,owner,10000,10000]);

    // Counts alone cannot fake a good snapshot; the lock trigger checks
    // the persisted SUM against each manifest field.
    await c.query("SAVEPOINT bad_manifest_sc004");
    await c.query(manifestSql,[cycle,group,randomUUID(),owner,20000,"a".repeat(64)]);
    await fails(lockSql,[cycle,owner],"Invalid cycle state transition");
    await c.query("ROLLBACK TO SAVEPOINT bad_manifest_sc004");
    await c.query("RELEASE SAVEPOINT bad_manifest_sc004");

    const key=randomUUID();
    await c.query(manifestSql,[cycle,group,key,owner,10000,"a".repeat(64)]);
    const locked=await c.query(lockSql,[cycle,owner]);
    assert.deepEqual(locked.rows[0],{state:"locked",version:3});
    await fails(lockSql,[cycle,owner],"Invalid cycle state transition");
    await fails("DELETE FROM group_settlement_cycles WHERE id=$1",
      [cycle],"Settlement cycles cannot be deleted");
    await fails("UPDATE group_settlement_cycle_snapshots SET original_minor=20000 WHERE cycle_id=$1",
      [cycle],"append-only");
    await fails("UPDATE group_settlement_cycle_snapshot_obligations SET pending_cash_minor=100 WHERE cycle_id=$1",
      [cycle],"append-only");
    await fails("DELETE FROM group_settlement_cycle_snapshot_expenses WHERE cycle_id=$1",
      [cycle],"append-only");
    await fails("UPDATE expenses SET total_minor=20000 WHERE id=$1",
      [expense],"Frozen cycle expense can only be creator-completed");
    await fails("UPDATE expenses SET deleted_at=clock_timestamp() WHERE id=$1",
      [expense],"Frozen cycle expense can only be creator-completed");
    await fails("DELETE FROM expense_items WHERE id=$1",
      [item],"Frozen invoice item shares cannot change");
    await fails("UPDATE expense_item_shares SET amount_minor=9000 WHERE item_id=$1",
      [item],"Frozen invoice item shares cannot change");
    await fails("UPDATE expense_items SET expense_id=$2 WHERE id=$1",
      [item,randomUUID()],"Frozen invoice item shares cannot change");
    await fails("UPDATE expense_item_shares SET item_id=$2 WHERE item_id=$1",
      [item,randomUUID()],"Frozen invoice item shares cannot change");
    await fails("UPDATE obligations SET voided_at=clock_timestamp() WHERE id=$1",
      [obligation],"Frozen obligation cannot be modified");
    await fails(`UPDATE expenses SET completed_at=clock_timestamp(),
      completed_by=$2,version=version+1,updated_at=clock_timestamp()
      WHERE id=$1`,[expense,owner],"Unpaid or pending debt");

    // Cash posted LATER than lock must not retroactively rewrite the snapshot.
    const pay=randomUUID();
    await c.query(`INSERT INTO settlements
      (id,group_id,debtor_id,creditor_id,initiated_by,status,
       amount_minor,request_key,request_fingerprint,resolved_at,resolved_by)
      VALUES($1,$2,$3,$4,$3,'confirmed',10000,$5,$6,clock_timestamp(),$4)`,
      [pay,group,debtor,owner,randomUUID(),"f".repeat(64)]);
    await c.query(`INSERT INTO settlement_allocations
      (settlement_id,obligation_id,group_id,debtor_id,creditor_id,amount_minor)
      VALUES($1,$2,$3,$4,$5,10000)`,
      [pay,obligation,group,debtor,owner]);
    await c.query(`UPDATE expenses SET completed_at=clock_timestamp(),
      completed_by=$2,version=version+1,updated_at=clock_timestamp()
      WHERE id=$1`,[expense,owner]);
    const saved=await c.query(`SELECT original_minor::text,
      confirmed_cash_minor::text,pending_cash_minor::text,
      outstanding_minor::text,available_minor::text
      FROM group_settlement_cycle_snapshot_obligations WHERE cycle_id=$1`,[cycle]);
    assert.deepEqual(saved.rows[0],{
      original_minor:"10000",confirmed_cash_minor:"0",pending_cash_minor:"0",
      outstanding_minor:"10000",available_minor:"10000",
    },"snapshot is historical even after later money actually arrived");
    // A new, backdated expense is allowed, but must NOT appear in a frozen
    // cycle. Later tickets will explicitly adjust it into a future cycle.
    const late=randomUUID();
    await c.query(`INSERT INTO expenses
      (id,group_id,payer_id,created_by,title,occurred_on,total_minor)
      VALUES($1,$2,$3,$3,'Late bill',$4,5000)`,
      [late,group,owner,asDate]);
    assert.equal((await c.query(
      "SELECT count(*)::int AS n FROM group_settlement_cycle_snapshot_expenses WHERE cycle_id=$1",
      [cycle])).rows[0].n,1);

  }finally{
    await c.query("ROLLBACK");
    c.release();
    await pool.end();
  }
});
