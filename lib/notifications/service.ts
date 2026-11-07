import "server-only";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { pool } from "@/lib/db/pool";

export type NotificationKind =
  | "settlement_requested" | "settlement_confirmed"
  | "settlement_rejected" | "settlement_cancelled"
  | "cycle_review" | "cycle_locked" | "setoff_proposed"
  | "setoff_decision" | "setoff_applied"
  | "late_invoice_attributed" | "cycle_dispute_opened"
  | "cycle_dispute_responded" | "cycle_dispute_closed"
  | "cycle_reminder";
export type SettlementNotificationKind=Extract<NotificationKind,
  "settlement_requested"|"settlement_confirmed"|
  "settlement_rejected"|"settlement_cancelled">;
export type AppNotification = {
  id: string; kind: NotificationKind; title: string; body: string;
  href: string; readAt: string | null; createdAt: string;
  actorName: string; groupName: string;
};
export class NotificationInputError extends Error {
  constructor(public status: 400 | 404, message: string) { super(message); }
}
const uuid = (x: unknown): x is string =>
  typeof x === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(x);

/** The caller MUST hold the settlement's transaction and group lock. */
export async function notifySettlement(
  client: PoolClient, settlementId: string, actorId: string, kind: SettlementNotificationKind,
) {
  const result = await client.query<{
    id: string; group_id: string; debtor_id: string;
    creditor_id: string; initiated_by: string; amount_minor: string;
    group_name: string;
  }>(
    `SELECT s.id, s.group_id, s.debtor_id, s.creditor_id, s.initiated_by,
      s.amount_minor::text, g.name AS group_name
     FROM settlements s JOIN groups g ON g.id=s.group_id
     WHERE s.id=$1`, [settlementId],
  );
  const settlement = result.rows[0];
  if (!settlement) throw new Error("Settlement notification target was not found");
  const recipient = (kind === "settlement_requested" || kind === "settlement_cancelled")
    ? (actorId === settlement.debtor_id ? settlement.creditor_id : settlement.debtor_id)
    : settlement.initiated_by;
  if (recipient === actorId) throw new Error("A notification cannot target its actor");
  const money = new Intl.NumberFormat("vi-VN").format(BigInt(settlement.amount_minor));
  const titles: Record<SettlementNotificationKind, string> = {
    settlement_requested: "Có yêu cầu xác nhận thanh toán",
    settlement_confirmed: "Thanh toán đã được xác nhận",
    settlement_rejected: "Yêu cầu thanh toán bị từ chối",
    settlement_cancelled: "Yêu cầu thanh toán đã bị hủy",
  };
  const descriptions: Record<SettlementNotificationKind, string> = {
    settlement_requested: `Bạn có yêu cầu xác nhận ${money} ₫ trong nhóm ${settlement.group_name}.`,
    settlement_confirmed: `Khoản thanh toán ${money} ₫ đã được hai bên xác nhận.`,
    settlement_rejected: `Yêu cầu thanh toán ${money} ₫ đã bị từ chối.`,
    settlement_cancelled: `Yêu cầu thanh toán ${money} ₫ đã bị hủy.`,
  };
  const row = await client.query<{ id: string }>(
    `INSERT INTO notifications
      (id,recipient_id,actor_id,group_id,settlement_id,kind,title,body,href)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (recipient_id,settlement_id,kind) DO NOTHING RETURNING id`,
    [randomUUID(),recipient,actorId,settlement.group_id,settlement.id,kind,
      titles[kind],descriptions[kind],
      `/groups/${settlement.group_id}/settlements/${settlement.id}`],
  );
  if (!row.rows[0]) return false;
  await client.query(
    `INSERT INTO notification_push_jobs(notification_id,subscription_id)
     SELECT $1,ps.id FROM push_subscriptions ps
     LEFT JOIN notification_preferences pref ON pref.user_id=ps.user_id
     WHERE ps.user_id=$2 AND COALESCE(pref.push_enabled,true)
     ON CONFLICT DO NOTHING`,
    [row.rows[0].id,recipient],
  );
  return true;
}
export async function notificationList(userId: string, rawLimit: number, cursor?: string) {
  const limit = Number.isInteger(rawLimit) ? Math.min(50, Math.max(1, rawLimit)) : 20;
  if (cursor !== undefined && !uuid(cursor)) throw new NotificationInputError(400,"Cursor không hợp lệ.");
  const rows = await pool.query<AppNotification>(
    `SELECT n.id,n.kind,n.title,n.body,n.href,n.read_at::text AS "readAt",
      n.created_at::text AS "createdAt",
      COALESCE(actor.name,'Hệ thống') AS "actorName",g.name AS "groupName"
     FROM notifications n LEFT JOIN "user" actor ON actor.id=n.actor_id
     JOIN groups g ON g.id=n.group_id
     WHERE n.recipient_id=$1
       AND ($2::uuid IS NULL OR (n.created_at,n.id) <
          (SELECT c.created_at,c.id FROM notifications c WHERE c.id=$2 AND c.recipient_id=$1))
     ORDER BY n.created_at DESC,n.id DESC LIMIT $3`,
    [userId,cursor??null,limit+1],
  );
  const items=rows.rows.slice(0,limit);
  return {items, nextCursor:rows.rows.length>limit?items.at(-1)?.id??null:null};
}
export async function unreadNotificationCount(userId: string) {
  const r=await pool.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM notifications WHERE recipient_id=$1 AND read_at IS NULL`,[userId]);
  return r.rows[0]?.count??0;
}
export async function markNotificationRead(userId:string,notificationId:string) {
  if(!uuid(notificationId))throw new NotificationInputError(404,"Không tìm thấy thông báo.");
  const r=await pool.query(
    `UPDATE notifications SET read_at=COALESCE(read_at,now())
     WHERE id=$1 AND recipient_id=$2 RETURNING id`, [notificationId,userId]);
  if (!r.rowCount) throw new NotificationInputError(404,"Không tìm thấy thông báo.");
}
export async function markAllNotificationsRead(userId:string) {
  const r=await pool.query(
    `UPDATE notifications SET read_at=now()
     WHERE recipient_id=$1 AND read_at IS NULL`,[userId]);
  return r.rowCount??0;
}
