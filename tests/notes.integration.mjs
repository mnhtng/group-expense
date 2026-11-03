import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import pg from "pg";

test("optional group, invitation and audit notes round-trip through SQL",async()=>{
  if(!process.env.DATABASE_URL)return;
  const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:1});
  const client=await pool.connect();
  try{
    await client.query("BEGIN");
    const userId=randomUUID(),groupId=randomUUID(),inviteId=randomUUID();
    const email=`notes-${userId}@example.test`;
    await client.query('INSERT INTO "user"(id,name,email) VALUES($1,$2,$3)',
      [userId,"Note test user",email]);
    await client.query("INSERT INTO groups(id,owner_id,name,notes) VALUES($1,$2,$3,$4)",
      [groupId,userId,"Notes group","Mỗi người góp một phần"]);
    await client.query("INSERT INTO group_members(group_id,user_id,role) VALUES($1,$2,'owner')",
      [groupId,userId]);
    await client.query(
      "INSERT INTO group_note_events(id,group_id,actor_id,event_type,note) VALUES($1,$2,$3,'created',$4)",
      [randomUUID(),groupId,userId,"Đã thống nhất chia tiền"]);
    await client.query(
      "INSERT INTO group_invites(id,group_id,token_hash,created_by,expires_at,notes) VALUES($1,$2,$3,$4,now()+interval '7 days',$5)",
      [inviteId,groupId,createHash("sha256").update(randomUUID()).digest("hex"),userId,"Lời mời nhóm"]);
    const group=await client.query("SELECT notes FROM groups WHERE id=$1",[groupId]);
    const invite=await client.query("SELECT notes FROM group_invites WHERE id=$1",[inviteId]);
    const history=await client.query("SELECT note FROM group_note_events WHERE group_id=$1",[groupId]);
    assert.equal(group.rows[0].notes,"Mỗi người góp một phần");
    assert.equal(invite.rows[0].notes,"Lời mời nhóm");
    assert.equal(history.rows[0].note,"Đã thống nhất chia tiền");
    await assert.rejects(
      client.query("UPDATE groups SET notes=$2 WHERE id=$1",[groupId,"x".repeat(1001)]),
      error=>error.code==="22001",
    );
  } finally {
    await client.query("ROLLBACK");
    client.release();
    await pool.end();
  }
});
