import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";

test("invoice notes and repayment event notes persist without group notes", async () => {
  if (!process.env.DATABASE_URL) return;
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const owner = randomUUID(), debtor = randomUUID();
    const groupId = randomUUID(), expenseId = randomUUID();
    const obligationId = randomUUID(), settlementId = randomUUID();

    for (const id of [owner, debtor]) {
      await client.query('INSERT INTO "user"(id,name,email) VALUES($1,$2,$3)',
        [id, "Test member", `finance-note-${id}@example.test`]);
    }
    await client.query("INSERT INTO groups(id,owner_id,name) VALUES($1,$2,$3)",
      [groupId,owner,"Financial note test"]);
    await client.query("INSERT INTO group_members(group_id,user_id,role) VALUES($1,$2,'owner')",
      [groupId,owner]);
    await client.query("INSERT INTO group_members(group_id,user_id,role) VALUES($1,$2,'member')",
      [groupId,debtor]);

    await client.query(`INSERT INTO expenses
      (id,group_id,payer_id,created_by,title,notes,total_minor)
      VALUES($1,$2,$3,$3,'Shared dinner',$4,50000)`,
      [expenseId,groupId,owner,"Chi tiền ăn tối"]);
    await client.query(`INSERT INTO expense_events
      (id,group_id,expense_id,actor_id,operation,version,snapshot)
      VALUES($1,$2,$3,$4,'created',1,$5::jsonb)`,
      [randomUUID(),groupId,expenseId,owner,JSON.stringify({note:"Lưu hóa đơn"})]);

    await client.query(`INSERT INTO obligations
      (id,group_id,expense_id,expense_version,debtor_id,creditor_id,amount_minor)
      VALUES($1,$2,$3,1,$4,$5,50000)`,
      [obligationId,groupId,expenseId,debtor,owner]);
    await client.query(`INSERT INTO settlements
      (id,group_id,debtor_id,creditor_id,initiated_by,amount_minor,
       request_key,request_fingerprint,note)
      VALUES($1,$2,$3,$4,$3,50000,$5,$6,$7)`,
      [settlementId,groupId,debtor,owner,randomUUID(),"0".repeat(64),"Đã chuyển khoản"]);
    await client.query(`INSERT INTO settlement_allocations
      (settlement_id,obligation_id,group_id,debtor_id,creditor_id,amount_minor)
      VALUES($1,$2,$3,$4,$5,50000)`,
      [settlementId,obligationId,groupId,debtor,owner]);
    await client.query(`INSERT INTO settlement_events
      (id,settlement_id,actor_id,event_type,note)
      VALUES($1,$2,$3,'created',$4)`,
      [randomUUID(),settlementId,debtor,"Đã chuyển khoản"]);
    await client.query(`UPDATE settlements SET status='confirmed',
      resolved_at=now(),resolved_by=$2 WHERE id=$1`,[settlementId,owner]);
    await client.query(`INSERT INTO settlement_events
      (id,settlement_id,actor_id,event_type,note)
      VALUES($1,$2,$3,'confirmed',$4)`,
      [randomUUID(),settlementId,owner,"Đã nhận đủ tiền"]);

    const e = await client.query("SELECT notes FROM expenses WHERE id=$1",[expenseId]);
    const s = await client.query("SELECT note FROM settlements WHERE id=$1",[settlementId]);
    const events = await client.query(`SELECT event_type,note FROM settlement_events
      WHERE settlement_id=$1 ORDER BY recorded_at,event_type`,[settlementId]);
    const audit = await client.query(`SELECT snapshot->>'note' AS note FROM expense_events
      WHERE expense_id=$1`,[expenseId]);

    assert.equal(e.rows[0].notes,"Chi tiền ăn tối");
    assert.equal(s.rows[0].note,"Đã chuyển khoản");
    assert.equal(events.rows.length,2);
    assert.equal(events.rows.find(x=>x.event_type==="confirmed")?.note,"Đã nhận đủ tiền");
    assert.equal(audit.rows[0].note,"Lưu hóa đơn");
  } finally {
    try { await client.query("ROLLBACK"); } finally {
      client.release();
      await pool.end();
    }
  }
});
