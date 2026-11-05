import {test} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import pg from "pg";

const EXPECTED="postgresql://test:test@localhost:5432/group_expense";
const it=process.env.CI==="true"&&process.env.SC007_TEST_ONLY==="isolated-pg17"&&
  process.env.DATABASE_URL===EXPECTED?test:test.skip;
const MONEY=10000n,BOOKED=7000n;
const createSettlement=`INSERT INTO settlements
  (id,group_id,debtor_id,creditor_id,initiated_by,status,amount_minor,
    request_key,request_fingerprint)
  VALUES($1,$2,$3,$4,$3,'pending',$5,$6,$7)`;
const allocate=`INSERT INTO settlement_allocations
  (settlement_id,obligation_id,group_id,debtor_id,creditor_id,amount_minor)
  VALUES($1,$2,$3,$4,$5,$6)`;
async function beginWrite(client,settlement,group,debtor,creditor,obligation,amount){
  await client.query("BEGIN");
  await client.query(createSettlement,
    [settlement,group,debtor,creditor,String(amount),randomUUID(),"a".repeat(64)]);
  await client.query(allocate,
    [settlement,obligation,group,debtor,creditor,String(amount)]);
}
it("SC-007 real PG17: concurrent cash writers can NEVER double-book original obligations",{
  timeout:120000,
},async()=>{
  const pool=new pg.Pool({connectionString:EXPECTED,max:6});
  const owner=randomUUID(),debtor=randomUUID(),group=randomUUID(),otherGroup=randomUUID();
  const originals=Array.from({length:16},()=>randomUUID());
  const attempts=[];
  try{
    const client=await pool.connect();
    try{
      await client.query("BEGIN");
      for(const user of [owner,debtor])
        await client.query('INSERT INTO "user"(id,name,email) VALUES($1,$2,$3)',
          [user,"SC007 concurrent money",`sc007-${user}@example.test`]);
      for(const g of [group,otherGroup]){
        await client.query("INSERT INTO groups(id,owner_id,name) VALUES($1,$2,$3)",
          [g,owner,"SC007 disposable concurrency"]);
        for(const [id,role] of [[owner,"owner"],[debtor,"member"]])
          await client.query(
            "INSERT INTO group_members(group_id,user_id,role) VALUES($1,$2,$3)",
            [g,id,role]);
      }
      for(let i=0;i<originals.length;i++){
        const bill=randomUUID(),item=randomUUID(),source=randomUUID();
        await client.query(`INSERT INTO expenses
          (id,group_id,payer_id,created_by,title,occurred_on,total_minor)
          VALUES($1,$2,$3,$3,$4,'2026-10-02',$5)`,
          [bill,group,owner,`SC007 original ${i}`,String(MONEY)]);
        await client.query(`INSERT INTO expense_items
          (id,expense_id,group_id,position,name,quantity,unit_price_minor,amount_minor)
          VALUES($1,$2,$3,0,'Original',1,$4,$4)`,
          [item,bill,group,String(MONEY)]);
        await client.query(`INSERT INTO expense_item_shares(item_id,group_id,user_id,amount_minor)
          VALUES($1,$2,$3,$4)`,[item,group,debtor,String(MONEY)]);
        await client.query(`INSERT INTO obligations
          (id,group_id,expense_id,expense_version,debtor_id,creditor_id,amount_minor)
          VALUES($1,$2,$3,1,$4,$5,$6)`,
          [originals[i],group,bill,debtor,owner,String(MONEY)]);
        await client.query(`INSERT INTO obligation_sources
          (id,obligation_id,expense_item_id,item_name,amount_minor)
          VALUES($1,$2,$3,'Original',$4)`,
          [source,originals[i],item,String(MONEY)]);
      }
      await client.query("COMMIT");
    }catch(e){await client.query("ROLLBACK");throw e;}
    finally{client.release();}

    // In EACH trial, two truly separate PostgreSQL sessions start with
    // one 7,000-VND pending reservation against the SAME 10,000-VND
    // original. Only one of two COMMITs may succeed, never both.
    for(const [i,obligation] of originals.entries()){
      const a=await pool.connect(),b=await pool.connect();
      const sa=randomUUID(),sb=randomUUID();
      try{
        await Promise.all([
          beginWrite(a,sa,group,debtor,owner,obligation,BOOKED),
          beginWrite(b,sb,group,debtor,owner,obligation,BOOKED),
        ]);
        const committed=await Promise.allSettled([a.query("COMMIT"),b.query("COMMIT")]);
        const ok=committed.filter(x=>x.status==="fulfilled").length;
        const denied=committed.filter(x=>x.status==="rejected");
        assert.equal(ok,1,`trial ${i}: only one cash transaction may COMMIT`);
        assert.equal(denied.length,1);
        assert.ok(denied[0].reason?.code==="40P01" ||
          /BN-005 cash exceeds live debt/.test(String(denied[0].reason?.message)),
          `trial ${i}: losing transaction must roll back on capacity or PostgreSQL deadlock`);
        const actual=await pool.query(`SELECT o.id,
          b.original_minor::text AS original,b.confirmed_cash_minor::text AS cash,
          b.pending_cash_minor::text AS pending,
          b.outstanding_minor::text AS outstanding,
          b.available_minor::text AS available,
          (SELECT count(*)::int FROM settlement_allocations sa
           WHERE sa.obligation_id=o.id) AS rows
          FROM obligations o JOIN bn005_obligation_balances b
            ON b.obligation_id=o.id WHERE o.id=$1`,[obligation]);
        const row=actual.rows[0];
        assert.equal(row.original,String(MONEY));
        assert.equal(row.cash,"0");
        assert.equal(row.pending,String(BOOKED));
        assert.equal(row.outstanding,String(MONEY));
        assert.equal(row.available,String(MONEY-BOOKED));
        assert.equal(row.rows,1,`trial ${i}: no orphan cash allocation`);
        attempts.push({obligation,committed:ok,denied:denied.length});
      }finally{
        await Promise.allSettled([a.query("ROLLBACK"),b.query("ROLLBACK")]);
        a.release();b.release();
      }
    }
    assert.equal(attempts.length,originals.length);

    // PostgreSQL composite foreign keys reject cross-group, cross-pair
    // allocations even if a caller forges group/actor IDs in raw SQL.
    const invalid=await pool.connect();
    try{
      await invalid.query("BEGIN");
      await invalid.query("SAVEPOINT invalid_sc007");
      const sid=randomUUID();
      await invalid.query(createSettlement,
        [sid,otherGroup,debtor,owner,"100",randomUUID(),"a".repeat(64)]);
      await assert.rejects(invalid.query(allocate,
        [sid,originals[0],otherGroup,debtor,owner,"100"]),
        e=>e.code==="23503");
      await invalid.query("ROLLBACK TO SAVEPOINT invalid_sc007");
      await invalid.query("RELEASE SAVEPOINT invalid_sc007");
      await invalid.query("COMMIT");
    }catch(e){await invalid.query("ROLLBACK");throw e;}
    finally{invalid.release();}

    // Partial cash (already PENDING 7000) leaves only 3000 AVAILABLE.
    // A raw SQL bypass trying 3001 more must fail at deferred COMMIT.
    const bypass=await pool.connect();
    try{
      await beginWrite(bypass,randomUUID(),group,debtor,owner,originals[0],3001n);
      await assert.rejects(bypass.query("COMMIT"),
        /BN-005 cash exceeds live debt/);
    }finally{
      await bypass.query("ROLLBACK");
      bypass.release();
    }
    const snapshot=await pool.query(`SELECT
      count(*)::int AS n,coalesce(sum(b.pending_cash_minor),0)::text AS pending,
      coalesce(sum(b.available_minor),0)::text AS available
      FROM obligations o JOIN bn005_obligation_balances b
        ON b.obligation_id=o.id WHERE o.group_id=$1`,[group]);
    assert.equal(snapshot.rows[0].n,originals.length);
    assert.equal(snapshot.rows[0].pending,String(BOOKED*BigInt(originals.length)));
    assert.equal(snapshot.rows[0].available,
      String((MONEY-BOOKED)*BigInt(originals.length)));
    console.log(JSON.stringify({sc007:"CONCURRENT_CASH_PASS",
      sessions:2,trials:attempts.length,survivors:attempts.length,
      rejected:attempts.length,groupScope:"disposable-only"}));
  }finally{await pool.end();}
});
