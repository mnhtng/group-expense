import "server-only";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { pool } from "@/lib/db/pool";
import { departGroup, rejoinExistingMember } from "@/lib/groups/membership";

export type GroupRow = { id: string; name: string; currency: string; role: string };
type MemberRole = "owner" | "admin" | "member";

export async function listGroups(userId: string): Promise<GroupRow[]> {
  const result = await pool.query<GroupRow>(
    `SELECT g.id, g.name, g.currency, m.role
     FROM groups g JOIN group_members m ON m.group_id = g.id
     WHERE m.user_id = $1 AND m.status='active' AND g.archived_at IS NULL ORDER BY g.created_at DESC`,
    [userId],
  );
  return result.rows;
}

export async function createGroup(ownerId: string, rawName: string) {
  const name = rawName.trim();
  if (name.length < 2 || name.length > 120) throw new Error("Tên nhóm cần từ 2 đến 120 ký tự.");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const id = randomUUID();
    await client.query("INSERT INTO groups (id, owner_id, name) VALUES ($1, $2, $3)", [id, ownerId, name]);
    await client.query("INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, 'owner')", [id, ownerId]);
    await client.query("COMMIT");
    return id;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function getMemberRole(groupId: string, userId: string): Promise<MemberRole | null> {
  const result = await pool.query<{ role: MemberRole }>(
    `SELECT m.role FROM group_members m JOIN groups g ON g.id = m.group_id
     WHERE g.id = $1 AND m.user_id = $2 AND m.status='active' AND g.archived_at IS NULL`,
    [groupId, userId],
  );
  return result.rows[0]?.role ?? null;
}

export async function getGroupDetails(groupId: string, userId: string) {
  const result = await pool.query<{ id: string; name: string; currency: string }>(
    `SELECT g.id, g.name, g.currency FROM groups g
     JOIN group_members m ON m.group_id = g.id
     WHERE g.id = $1 AND m.user_id = $2 AND m.status='active' AND g.archived_at IS NULL`,
    [groupId, userId],
  );
  return result.rows[0] ?? null;
}

export async function archiveGroup(groupId: string, ownerId: string, confirmation: string) {
  const result = await pool.query(
    `UPDATE groups g SET archived_at=now(), updated_at=now()
     WHERE g.id=$1 AND g.owner_id=$2 AND g.name=$3 AND g.archived_at IS NULL
       AND NOT EXISTS(SELECT 1 FROM settlements s
         WHERE s.group_id=g.id AND s.status='pending')
       AND NOT EXISTS(
         SELECT 1 FROM obligations o
         JOIN expenses e ON e.id=o.expense_id
         WHERE o.group_id=g.id AND o.voided_at IS NULL
           AND e.deleted_at IS NULL
           AND EXISTS(
             SELECT 1 FROM bn005_obligation_balances b
             WHERE b.obligation_id=o.id
               AND (b.outstanding_minor<>0 OR b.available_minor<0))
       )
       -- SC-006: neither a reviewed-but-unlocked cycle nor an unresolved
       -- frozen original invoice may be lost by archiving its group.
       AND NOT EXISTS(
         SELECT 1 FROM group_settlement_cycles c
         WHERE c.group_id=g.id AND (
           c.state IN ('open','review')
           OR EXISTS(
             SELECT 1 FROM group_settlement_cycle_snapshot_expenses se
             JOIN expenses e ON e.id=se.expense_id
             WHERE se.cycle_id=c.id AND e.deleted_at IS NULL
               AND e.completed_at IS NULL
           )
           OR EXISTS(
             SELECT 1 FROM group_settlement_cycle_snapshot_obligations so
             JOIN bn005_obligation_balances bal ON bal.obligation_id=so.obligation_id
             WHERE so.cycle_id=c.id
               AND (bal.outstanding_minor<>0 OR bal.pending_cash_minor<>0
                 OR bal.available_minor<0)
           )
           OR (c.state='locked' AND EXISTS(
             SELECT 1 FROM expenses late
             JOIN group_settlement_cycle_snapshots snap ON snap.cycle_id=c.id
             WHERE late.group_id=g.id AND late.deleted_at IS NULL
               AND late.occurred_on>=c.period_start AND late.occurred_on<c.period_end
               AND (late.created_at>snap.cutoff_at OR late.updated_at>snap.cutoff_at)
               AND NOT EXISTS(
                 SELECT 1 FROM group_settlement_cycle_snapshot_expenses se
                 WHERE se.expense_id=late.id)
               AND NOT EXISTS(
                 SELECT 1 FROM group_settlement_cycle_adjustments adj
                 WHERE adj.expense_id=late.id)
           ))
         )
       )`,
    [groupId, ownerId, confirmation.trim()],
  );
  if (result.rowCount !== 1) throw new Error("Không thể lưu trữ: sai quyền/tên xác nhận hoặc nhóm còn công nợ chưa thanh toán.");
}

export async function renameGroup(groupId: string, actorId: string, rawName: string) {
  const name = rawName.trim();
  if (name.length < 2 || name.length > 120) throw new Error("Tên nhóm không hợp lệ.");
  const result = await pool.query(
    `UPDATE groups g SET name = $3, updated_at = now()
     WHERE g.id = $1 AND g.archived_at IS NULL
       AND EXISTS (SELECT 1 FROM group_members m WHERE m.group_id = g.id
         AND m.user_id = $2 AND m.status='active' AND m.role IN ('owner', 'admin'))`,
    [groupId, actorId, name],
  );
  if (result.rowCount !== 1) throw new Error("Không có quyền sửa nhóm.");
}

export async function createInvite(groupId: string, actorId: string) {
  const client=await pool.connect();
  try {
    await client.query("BEGIN");
    const group=await client.query(
      "SELECT id FROM groups WHERE id=$1 AND archived_at IS NULL FOR UPDATE",[groupId]);
    if(!group.rowCount)throw new Error("Không tìm thấy nhóm.");
    const role=await client.query<{role:string}>(
      `SELECT role FROM group_members
       WHERE group_id=$1 AND user_id=$2 AND status='active'
       AND role IN ('owner','admin')`,[groupId,actorId]);
    if(!role.rowCount)throw new Error("Không có quyền mời.");
    const token=randomBytes(32).toString("base64url");
    const hash=createHash("sha256").update(token).digest("hex");
    await client.query(
      `INSERT INTO group_invites(id,group_id,token_hash,created_by,expires_at)
       VALUES($1,$2,$3,$4,now()+interval '7 days')`,
      [randomUUID(),groupId,hash,actorId]);
    await client.query("COMMIT");
    return token;
  }catch(error){await client.query("ROLLBACK");throw error}
  finally{client.release()}
}

export async function acceptInvite(userId: string, token: string) {
  if(!/^[A-Za-z0-9_-]{32,100}$/.test(token))
    throw new Error("Liên kết không hợp lệ.");
  const hash=createHash("sha256").update(token).digest("hex");
  const client=await pool.connect();
  try {
    await client.query("BEGIN");
    // Find the group first, then lock its row before checking invite usage.
    // Same lock ordering as leave, expense and settlement transactions.
    const preview=await client.query<{group_id:string}>(
      "SELECT group_id FROM group_invites WHERE token_hash=$1",[hash]);
    if(!preview.rows[0])throw new Error("Lời mời không hợp lệ.");
    const g=await client.query(
      "SELECT id FROM groups WHERE id=$1 AND archived_at IS NULL FOR UPDATE",
      [preview.rows[0].group_id]);
    if(!g.rowCount)throw new Error("Nhóm không còn hoạt động.");
    const found=await client.query<{id:string;group_id:string}>(
      `SELECT i.id,i.group_id FROM group_invites i
       WHERE i.token_hash=$1 AND i.expires_at>now() AND i.revoked_at IS NULL
         AND i.uses_count<i.max_uses FOR UPDATE OF i`,[hash]);
    const invite=found.rows[0];
    if(!invite)throw new Error("Lời mời đã hết hạn hoặc không còn hiệu lực.");
    const joined=await rejoinExistingMember(client,invite.group_id,userId,userId);
    if(joined){
      await client.query("UPDATE group_invites SET uses_count=uses_count+1 WHERE id=$1",
        [invite.id]);
    }
    await client.query("COMMIT");
    return invite.group_id;
  }catch(error){await client.query("ROLLBACK");throw error}
  finally{client.release()}
}

export async function listMembers(groupId: string, userId: string) {
  if (!(await getMemberRole(groupId, userId))) throw new Error("Không thuộc nhóm.");
  const result = await pool.query<{ id: string; name: string; role: string }>(
    `SELECT u.id, u.name, m.role FROM group_members m
     JOIN "user" u ON u.id = m.user_id WHERE m.group_id = $1 AND m.status='active'
     ORDER BY m.joined_at ASC`,
    [groupId],
  );
  return result.rows;
}

export async function removeMember(groupId: string, actorId: string, memberId: string) {
  // Preserve financial foreign keys and receipts instead of deleting membership.
  return departGroup(groupId,actorId,memberId,actorId===memberId?"left":"removed");
}
