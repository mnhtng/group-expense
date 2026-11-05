import "server-only";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { pool } from "@/lib/db/pool";
import { revokeSettlementManagersWithMembership } from "@/lib/settlement-cycles/settings";

export class MembershipError extends Error {
  constructor(public statusCode: 400 | 403 | 404 | 409, message: string) {
    super(message);
    this.name = "MembershipError";
  }
}

export type ExitEligibility = {
  canLeave: boolean;
  reason: "ready" | "owner" | "unsettled" | "pending" | "creator_confirmation";
  toPayMinor: string;
  toReceiveMinor: string;
  pendingCount: number;
  uncompletedInvoiceCount: number;
};

async function transaction<T>(cb:(client:PoolClient)=>Promise<T>):Promise<T>{
  const client=await pool.connect();
  try {
    await client.query("BEGIN");
    const value=await cb(client);
    await client.query("COMMIT");
    return value;
  } catch(error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {client.release()}
}

async function lockGroup(client:PoolClient,groupId:string){
  // Consistent lock order: group -> membership/obligations.
  // Expense and settlement writes take this lock first.
  const result=await client.query<{owner_id:string}>(
    "SELECT owner_id FROM groups WHERE id=$1 AND archived_at IS NULL FOR UPDATE",
    [groupId],
  );
  if(!result.rows[0])throw new MembershipError(404,"Không tìm thấy nhóm.");
  return result.rows[0];
}
async function activeRole(client:PoolClient,groupId:string,userId:string) {
  const r=await client.query<{role:"owner"|"admin"|"member"}>(
    "SELECT role FROM group_members WHERE group_id=$1 AND user_id=$2 AND status='active'",
    [groupId,userId]);
  return r.rows[0]?.role??null;
}

async function eligibility(client:PoolClient,groupId:string,userId:string,isOwner:boolean):Promise<ExitEligibility> {
  const result=await client.query<{toPayMinor:string;toReceiveMinor:string;pendingCount:number;invalidCount:number;uncompletedInvoiceCount:number}>(
    `WITH remaining AS (
      SELECT o.debtor_id,o.creditor_id,b.outstanding_minor AS due
      FROM obligations o
      JOIN bn005_obligation_balances b ON b.obligation_id=o.id
      JOIN expenses e ON e.id=o.expense_id
      WHERE o.group_id=$1 AND o.voided_at IS NULL AND e.deleted_at IS NULL
        AND (o.debtor_id=$2 OR o.creditor_id=$2)
    )
    SELECT
      COALESCE(sum(due) FILTER(WHERE debtor_id=$2),0)::text AS "toPayMinor",
      COALESCE(sum(due) FILTER(WHERE creditor_id=$2),0)::text AS "toReceiveMinor",
      count(*) FILTER(WHERE due<0)::int AS "invalidCount",
      (SELECT count(*)::int FROM settlements
       WHERE group_id=$1 AND status='pending'
         AND (debtor_id=$2 OR creditor_id=$2)) AS "pendingCount",
      (SELECT count(*)::int FROM expenses e
       WHERE e.group_id=$1 AND e.created_by=$2 AND e.deleted_at IS NULL
         AND e.completed_at IS NULL AND (
           EXISTS(SELECT 1 FROM group_settlement_cycle_snapshot_expenses se
             WHERE se.expense_id=e.id)
           OR EXISTS(SELECT 1 FROM group_settlement_cycle_adjustments adj
             WHERE adj.expense_id=e.id)
           OR EXISTS(SELECT 1 FROM group_settlement_cycles c
             JOIN group_settlement_cycle_snapshots snap ON snap.cycle_id=c.id
             WHERE c.group_id=$1 AND c.state='locked'
               AND e.occurred_on>=c.period_start AND e.occurred_on<c.period_end
               AND e.created_at>snap.cutoff_at)
         )) AS "uncompletedInvoiceCount"
    FROM remaining`,
    [groupId,userId],
  );
  const stats=result.rows[0]??{toPayMinor:"0",toReceiveMinor:"0",pendingCount:0,invalidCount:0,uncompletedInvoiceCount:0};
  if(stats.invalidCount>0)throw new MembershipError(409,
    "Số dư công nợ không hợp lệ; không thể rời nhóm trước khi đối soát.");
  const hasDebt=BigInt(stats.toPayMinor)>0n||BigInt(stats.toReceiveMinor)>0n;
  const reason:ExitEligibility["reason"]=isOwner?"owner":
    stats.pendingCount>0?"pending":hasDebt?"unsettled":
    stats.uncompletedInvoiceCount>0?"creator_confirmation":"ready";
  return {canLeave:reason==="ready",reason,...stats};
}

export async function getExitEligibility(groupId:string,userId:string):Promise<ExitEligibility|null>{
  // Read-only preflight for UI. The action MUST re-check under a lock.
  const client=await pool.connect();
  try {
    const member=await client.query<{role:string;owner_id:string}>(
      `SELECT m.role,g.owner_id FROM group_members m
       JOIN groups g ON g.id=m.group_id AND g.archived_at IS NULL
       WHERE m.group_id=$1 AND m.user_id=$2 AND m.status='active'`,[groupId,userId]);
    if(!member.rows[0])return null;
    return eligibility(client,groupId,userId,member.rows[0].owner_id===userId);
  }finally{client.release()}
}

async function recordEvent(client:PoolClient,groupId:string,userId:string,actorId:string,
kind:"left"|"removed"|"rejoined"|"ownership_transferred",details:object={}) {
  await client.query(
    `INSERT INTO group_membership_events (id,group_id,user_id,actor_id,kind,details)
     VALUES($1,$2,$3,$4,$5,$6::jsonb)`,
    [randomUUID(),groupId,userId,actorId,kind,JSON.stringify(details)]);
}

/** Rejects deletion if ANY financial obligation in either direction remains. */
export async function departGroup(groupId:string,actorId:string,targetId:string,mode:"left"|"removed") {
  return transaction(async client=>{
    const group=await lockGroup(client,groupId);
    const actorRole=await activeRole(client,groupId,actorId);
    const targetRole=await activeRole(client,groupId,targetId);
    if(!actorRole||!targetRole)throw new MembershipError(404,"Không tìm thấy thành viên đang hoạt động.");
    if(group.owner_id===targetId)throw new MembershipError(409,"Chủ nhóm phải chuyển quyền sở hữu trước.");
    if(mode==="left") {
      if(actorId!==targetId)throw new MembershipError(403,"Chỉ được tự rời nhóm.");
    } else {
      if(actorId===targetId)throw new MembershipError(403,"Hãy dùng chức năng Rời nhóm.");
      if(actorRole!=="owner" && !(actorRole==="admin"&&targetRole==="member")) {
        throw new MembershipError(403,"Bạn không có quyền xóa thành viên này.");
      }
    }
    const check=await eligibility(client,groupId,targetId,false);
    if(!check.canLeave) {
      throw new MembershipError(409,
        `Còn nghĩa vụ cần giải quyết: trả ${check.toPayMinor}đ, nhận ${check.toReceiveMinor}đ, chờ ${check.pendingCount}, hóa đơn cần người tạo chốt ${check.uncompletedInvoiceCount}.`);
    }
    // A member who departs can no longer create recurring invoices or pay
    // for a template that still includes them. Pause affected rules under
    // the SAME group-locked membership transaction, preserving past bills.
    const paused=await client.query(
      `UPDATE recurring_expense_rules r SET status='paused',
         pause_reason='Thành viên của mẫu đã rời nhóm; cần sửa và tiếp tục.',
         version=version+1,updated_at=now()
       WHERE r.group_id=$1 AND r.status='active'
         AND (r.created_by=$2 OR r.payer_id=$2 OR EXISTS(
           SELECT 1 FROM jsonb_array_elements(r.items) item
           WHERE COALESCE(item->'participants','[]'::jsonb) ? $2
              OR EXISTS(SELECT 1 FROM jsonb_array_elements(
                 COALESCE(item->'shares','[]'::jsonb)) sh
                 WHERE sh->>'userId'=$2)
         ))`,
      [groupId,targetId]);
    const r=await client.query(
      `UPDATE group_members SET status=$3,left_at=now(),
         removed_by=CASE WHEN $3='removed' THEN $4 ELSE NULL END,
         role='member'
       WHERE group_id=$1 AND user_id=$2 AND status='active'`,
      [groupId,targetId,mode,actorId],
    );
    if(r.rowCount!==1)throw new MembershipError(409,"Thành viên đã thay đổi trạng thái.");
    // Revoke BEFORE COMMIT: a future rejoin must never restore previous delegation.
    await revokeSettlementManagersWithMembership(client,groupId,actorId,"member_departed",targetId);
    await recordEvent(client,groupId,targetId,actorId,mode,{pausedRecurringRules:paused.rowCount});
    return {status:mode};
  });
}

export async function transferGroupOwnership(groupId:string,actorId:string,targetId:string) {
  return transaction(async client=>{
    const group=await lockGroup(client,groupId);
    if(group.owner_id!==actorId || !(await activeRole(client,groupId,actorId)))
      throw new MembershipError(403,"Chỉ chủ nhóm hiện tại được chuyển quyền.");
    if(actorId===targetId)throw new MembershipError(400,"Phải chọn một thành viên khác.");
    const role=await activeRole(client,groupId,targetId);
    if(!role || role==="owner")throw new MembershipError(404,"Chỉ được chuyển cho thành viên đang hoạt động.");
    // Downgrade first to satisfy unique active-owner index; transaction atomic.
    await client.query(`UPDATE group_members SET role='member'
      WHERE group_id=$1 AND user_id=$2 AND status='active'`,[groupId,actorId]);
    await client.query(`UPDATE group_members SET role='owner'
      WHERE group_id=$1 AND user_id=$2 AND status='active'`,[groupId,targetId]);
    await client.query("UPDATE groups SET owner_id=$2,updated_at=now() WHERE id=$1",
      [groupId,targetId]);
    // All old grants are revoked; new owner can explicitly re-authorize managers.
    await revokeSettlementManagersWithMembership(client,groupId,actorId,"ownership_transferred");
    await recordEvent(client,groupId,targetId,actorId,"ownership_transferred",
      {previousOwnerId:actorId,newOwnerId:targetId});
    return {ownerId:targetId};
  });
}

export async function rejoinExistingMember(client:PoolClient,groupId:string,userId:string,actorId:string) {
  const previous=await client.query<{status:string}>(
    `SELECT status FROM group_members WHERE group_id=$1 AND user_id=$2 FOR UPDATE`,
    [groupId,userId],
  );
  if(previous.rows[0]?.status==="active")return false;
  if(previous.rows[0]){
    // Previously removed members must receive a fresh invite.
    await client.query(
      `UPDATE group_members SET status='active',role='member',
        left_at=NULL,removed_by=NULL,rejoined_at=now()
       WHERE group_id=$1 AND user_id=$2`,[groupId,userId],
    );
    await recordEvent(client,groupId,userId,actorId,"rejoined");
    return true;
  }
  await client.query(
    "INSERT INTO group_members(group_id,user_id,role) VALUES ($1,$2,'member')",
    [groupId,userId],
  );
  return true;
}
