import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { pool } from "@/lib/db/pool";
import type { PoolClient } from "pg";
import { notifySettlement } from "@/lib/notifications/service";

export type SettlementStatus = "pending" | "confirmed" | "rejected" | "cancelled";
export type SettlementAllocationInput = { obligationId: string; amountMinor: string };
export type CreateSettlementInput = {
  requestKey: string;
  allocations: SettlementAllocationInput[];
  note?: string;
};

export class SettlementError extends Error {
  constructor(public readonly statusCode: 400 | 403 | 404 | 409, message: string) {
    super(message);
    this.name = "SettlementError";
  }
}
type SettlementRow = {
  id: string; groupId: string; debtorId: string; creditorId: string;
  initiatedBy: string; status: SettlementStatus; amountMinor: string;
  note: string | null; groupName: string; createdAt: string; resolvedAt: string | null;
  resolvedBy: string | null; debtorName: string; creditorName: string;
};
type AllocationRow = { obligationId: string; amountMinor: string; expenseId: string; expenseTitle: string };
export type SettlementDetail = SettlementRow & { allocations: AllocationRow[];
  events: { eventType: string; actorId: string; note: string | null; recordedAt: string }[] };

const validUUID = (s: unknown): s is string =>
  typeof s === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
function validAmount(s: unknown) {
  return typeof s === "string" && /^[1-9][0-9]*$/.test(s) &&
    BigInt(s) <= 9_223_372_036_854_775_807n;
}
function normalize(input: CreateSettlementInput) {
  if (!input || !validUUID(input.requestKey)) throw new SettlementError(400, "Mã yêu cầu không hợp lệ.");
  if (!Array.isArray(input.allocations) || input.allocations.length < 1 ||
      input.allocations.length > 50) throw new SettlementError(400, "Cần 1–50 khoản nợ.");
  if (input.allocations.some(a => !a || !validUUID(a.obligationId) || !validAmount(a.amountMinor))) {
    throw new SettlementError(400, "Khoản phân bổ phải là số nguyên VND dương.");
  }
  const sorted = [...input.allocations].sort((a,b) => a.obligationId.localeCompare(b.obligationId,"en"));
  if (new Set(sorted.map(a => a.obligationId)).size !== sorted.length) {
    throw new SettlementError(400, "Không được chọn trùng khoản nợ.");
  }
  const note = input.note === undefined ? "" : input.note;
  if (typeof note !== "string" || note.length > 500) throw new SettlementError(400, "Ghi chú tối đa 500 ký tự.");
  const amount = sorted.reduce((sum,a)=>sum+BigInt(a.amountMinor),0n);
  if (amount > 9_223_372_036_854_775_807n) throw new SettlementError(400, "Số tiền vượt giới hạn.");
  const fingerprint = createHash("sha256")
    .update(JSON.stringify({ allocations: sorted, note: note.trim() })).digest("hex");
  return { requestKey: input.requestKey, allocations: sorted,
    note: note.trim(), amount: amount.toString(), fingerprint };
}
async function transaction<T>(cb:(client:PoolClient)=>Promise<T>):Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await cb(client);
    await client.query("COMMIT");
    return result;
  } catch(error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}
async function memberGate(client:PoolClient, groupId:string, actorId:string) {
  if (!validUUID(groupId)) throw new SettlementError(404,"Không tìm thấy nhóm.");
  // Same group lock order as expense creation/edit and participant removal.
  const g = await client.query(
    "SELECT id FROM groups WHERE id=$1 AND archived_at IS NULL FOR UPDATE", [groupId],
  );
  if (!g.rowCount) throw new SettlementError(404, "Không tìm thấy nhóm.");
  const m = await client.query(
    "SELECT 1 FROM group_members WHERE group_id=$1 AND user_id=$2", [groupId,actorId],
  );
  if (!m.rowCount) throw new SettlementError(404, "Không tìm thấy nhóm.");
}
export async function createSettlement(groupId:string, actorId:string, raw:CreateSettlementInput) {
  const input=normalize(raw);
  return transaction(async client=>{
    await memberGate(client,groupId,actorId);
    const existing=await client.query<{id:string;request_fingerprint:string}>(
      "SELECT id,request_fingerprint FROM settlements WHERE group_id=$1 AND initiated_by=$2 AND request_key=$3",
      [groupId,actorId,input.requestKey],
    );
    if (existing.rows[0]) {
      if(existing.rows[0].request_fingerprint!==input.fingerprint)
        throw new SettlementError(409,"Mã yêu cầu đã dùng cho số tiền khác.");
      return {id:existing.rows[0].id,alreadyCreated:true};
    }
    const ids=input.allocations.map(a=>a.obligationId);
    const rows=await client.query<{id:string;debtor_id:string;creditor_id:string;amount_minor:string;
      voided_at:string|null;confirmed_minor:string;pending_minor:string}>(
      `SELECT o.id,o.debtor_id,o.creditor_id,o.amount_minor::text,o.voided_at,
         COALESCE((SELECT SUM(sa.amount_minor) FROM settlement_allocations sa
           JOIN settlements s ON s.id=sa.settlement_id
           WHERE sa.obligation_id=o.id AND s.status='confirmed'),0)::text AS confirmed_minor,
         COALESCE((SELECT SUM(sa.amount_minor) FROM settlement_allocations sa
           JOIN settlements s ON s.id=sa.settlement_id
           WHERE sa.obligation_id=o.id AND s.status='pending'),0)::text AS pending_minor
       FROM obligations o JOIN expenses e ON e.id=o.expense_id
       WHERE o.group_id=$1 AND o.id=ANY($2::uuid[]) AND o.voided_at IS NULL
         AND e.deleted_at IS NULL ORDER BY o.id FOR UPDATE OF o`,
      [groupId,ids],
    );
    if(rows.rows.length!==ids.length) throw new SettlementError(404,"Khoản nợ đã hết hiệu lực hoặc không tồn tại.");
    const debtor=rows.rows[0].debtor_id,creditor=rows.rows[0].creditor_id;
    if (!rows.rows.every(r=>r.debtor_id===debtor && r.creditor_id===creditor))
      throw new SettlementError(400,"Chỉ gộp khoản nợ cùng người phải trả và người nhận trong cùng nhóm.");
    if (actorId!==debtor && actorId!==creditor)
      throw new SettlementError(403,"Chỉ hai bên liên quan được báo thanh toán.");
    const amounts=new Map(input.allocations.map(a=>[a.obligationId,BigInt(a.amountMinor)]));
    for(const row of rows.rows) {
      const available=BigInt(row.amount_minor)-BigInt(row.confirmed_minor)-BigInt(row.pending_minor);
      if ((amounts.get(row.id)??0n)>available)
        throw new SettlementError(409,"Tiền yêu cầu vượt số dư khả dụng; đã có khoản đang chờ hoặc đã trả.");
    }
    const id=randomUUID();
    await client.query(
      `INSERT INTO settlements (id,group_id,debtor_id,creditor_id,initiated_by,status,
        amount_minor,request_key,request_fingerprint,note)
       VALUES ($1,$2,$3,$4,$5,'pending',$6,$7,$8,$9)`,
      [id,groupId,debtor,creditor,actorId,input.amount,input.requestKey,input.fingerprint,input.note],
    );
    for(const a of input.allocations){
      await client.query(
        `INSERT INTO settlement_allocations(settlement_id,obligation_id,group_id,debtor_id,creditor_id,amount_minor)
         VALUES($1,$2,$3,$4,$5,$6)`,
        [id,a.obligationId,groupId,debtor,creditor,a.amountMinor],
      );
    }
    await client.query(
      `INSERT INTO settlement_events(id,settlement_id,actor_id,event_type,note)
       VALUES ($1,$2,$3,'created',$4)`,[randomUUID(),id,actorId,input.note],
    );
    await notifySettlement(client,id,actorId,"settlement_requested");
    return {id,alreadyCreated:false};
  });
}
export async function resolveSettlement(groupId:string,settlementId:string,actorId:string,
  action:"confirm"|"reject"|"cancel",note?:string) {
  if(!validUUID(settlementId)) throw new SettlementError(404,"Không tìm thấy yêu cầu.");
  if(note!==undefined && (typeof note!=="string" || note.length>500))
    throw new SettlementError(400,"Ghi chú tối đa 500 ký tự.");
  return transaction(async client=>{
    await memberGate(client,groupId,actorId);
    const result=await client.query<{id:string;status:SettlementStatus;initiated_by:string;
      debtor_id:string;creditor_id:string;}>(
      `SELECT id,status,initiated_by,debtor_id,creditor_id FROM settlements
       WHERE id=$1 AND group_id=$2 FOR UPDATE`,[settlementId,groupId],
    );
    const row=result.rows[0];
    if(!row)throw new SettlementError(404,"Không tìm thấy yêu cầu.");
    if(row.status!=="pending")throw new SettlementError(409,"Yêu cầu đã được xử lý.");
    const isInitiator=actorId===row.initiated_by;
    if(action==="cancel") {
      if(!isInitiator)throw new SettlementError(403,"Chỉ người tạo mới được hủy yêu cầu.");
    } else {
      if(isInitiator || ![row.debtor_id,row.creditor_id].includes(actorId))
        throw new SettlementError(403,"Chỉ bên đối ứng mới có thể xác nhận hoặc từ chối.");
    }
    const next: SettlementStatus=action==="confirm"?"confirmed":action==="reject"?"rejected":"cancelled";
    await client.query(
      `UPDATE settlements SET status=$2,resolved_at=now(),resolved_by=$3 WHERE id=$1`,
      [settlementId,next,actorId],
    );
    await client.query(
      `INSERT INTO settlement_events(id,settlement_id,actor_id,event_type,note)
       VALUES ($1,$2,$3,$4,$5)`,
      [randomUUID(),settlementId,actorId,next,note?.trim()??""],
    );
    await notifySettlement(client,settlementId,actorId,`settlement_${next}` as
      "settlement_confirmed"|"settlement_rejected"|"settlement_cancelled");
    return {id:settlementId,status:next};
  });
}

const selectSettlement=`
  SELECT s.id,s.group_id AS "groupId",s.debtor_id AS "debtorId",
    d.name AS "debtorName",s.creditor_id AS "creditorId",c.name AS "creditorName",
    s.initiated_by AS "initiatedBy",s.status,s.amount_minor::text AS "amountMinor",
    s.note,s.created_at::text AS "createdAt",s.resolved_at::text AS "resolvedAt",
    s.resolved_by AS "resolvedBy",g.name AS "groupName"
  FROM settlements s
  JOIN "user" d ON d.id=s.debtor_id JOIN "user" c ON c.id=s.creditor_id
  JOIN groups g ON g.id=s.group_id AND g.archived_at IS NULL
  WHERE EXISTS(SELECT 1 FROM group_members m
    WHERE m.group_id=s.group_id AND m.user_id=$1)
`;
export async function listGroupSettlements(groupId:string,actorId:string):Promise<SettlementRow[]|null> {
  if(!validUUID(groupId)) return null;
  const gate=await pool.query(
    `SELECT 1 FROM group_members m JOIN groups g ON g.id=m.group_id
     WHERE g.id=$1 AND m.user_id=$2 AND g.archived_at IS NULL`,[groupId,actorId]);
  if(!gate.rowCount)return null;
  const rows=await pool.query<SettlementRow>(
    selectSettlement+" AND s.group_id=$2 ORDER BY (s.status='pending') DESC,s.created_at DESC LIMIT 150",
    [actorId,groupId],
  );
  return rows.rows;
}
export async function listPersonalSettlements(actorId:string):Promise<(SettlementRow & {groupName:string})[]>{
  const rows=await pool.query<SettlementRow & {groupName:string}>(
    selectSettlement+` AND (s.debtor_id=$1 OR s.creditor_id=$1)
      AND s.status='pending' ORDER BY s.created_at DESC LIMIT 150`
      ,[actorId],
  );
  return rows.rows;
}
export async function getSettlementDetail(groupId:string,settlementId:string,actorId:string):
  Promise<SettlementDetail|null> {
  if(!validUUID(groupId)||!validUUID(settlementId))return null;
  const row=await pool.query<SettlementRow>(
    selectSettlement+" AND s.group_id=$2 AND s.id=$3",
    [actorId,groupId,settlementId],
  );
  if(!row.rows[0])return null;
  const allocations=await pool.query<AllocationRow>(
    `SELECT a.obligation_id AS "obligationId",a.amount_minor::text AS "amountMinor",
      o.expense_id AS "expenseId",e.title AS "expenseTitle"
      FROM settlement_allocations a JOIN obligations o ON o.id=a.obligation_id
      JOIN expenses e ON e.id=o.expense_id
      WHERE a.settlement_id=$1 ORDER BY e.occurred_on,o.id`,[settlementId],
  );
  const events=await pool.query<SettlementDetail["events"][number]>(
    `SELECT event_type AS "eventType",actor_id AS "actorId",note,recorded_at::text AS "recordedAt"
      FROM settlement_events WHERE settlement_id=$1 ORDER BY recorded_at,id`,[settlementId],
  );
  return {...row.rows[0],allocations:allocations.rows,events:events.rows};
}
