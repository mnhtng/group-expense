import "server-only";
import {randomUUID} from "node:crypto";
import type {PoolClient} from "pg";
import {pool} from "@/lib/db/pool";
import {getSettlementSettings,SettlementSettingsError,
  withAuthorizedCycleManager} from "@/lib/settlement-cycles/settings";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fail=(status:400|403|404|409,message:string)=>
  new SettlementSettingsError(status,message);
type LateRow={
  id:string;title:string;occurredOn:string;expenseVersion:number;
  totalMinor:string;createdBy:string;recurringRuleId:string|null;
  recurringPeriod:string|null;assignedTargetId:string|null;
};
type Cycle={id:string;state:string;periodStart:string;periodEnd:string;
  cutoffAt:Date|null};
type Assignment={
  id:string;groupId:string;originCycleId:string;targetCycleId:string;
  expenseId:string;expenseVersion:number;actorId:string;requestKey:string;
  note:string;createdAt:Date;
};
const originSql=`SELECT c.id,c.state,c.period_start::text AS "periodStart",
  c.period_end::text AS "periodEnd",s.cutoff_at AS "cutoffAt"
  FROM group_settlement_cycles c
  LEFT JOIN group_settlement_cycle_snapshots s ON s.cycle_id=c.id
    AND s.group_id=c.group_id
  WHERE c.id=$1 AND c.group_id=$2`;
function validateIds(groupId:string,originCycleId:string,expenseId?:string) {
  if(!UUID.test(groupId)||!UUID.test(originCycleId)||
    (expenseId!==undefined&&!UUID.test(expenseId)))
    throw fail(400,"Mã nhóm, kỳ hoặc hóa đơn không hợp lệ.");
}
async function original(client:PoolClient,groupId:string,originCycleId:string){
  const r=await client.query<Cycle>(originSql,[originCycleId,groupId]);
  const c=r.rows[0];
  if(!c)throw fail(404,"Không tìm thấy kỳ quyết toán.");
  if(c.state!=="locked"||!c.cutoffAt)
    throw fail(409,"Chỉ xử lý hóa đơn phát sinh muộn sau một kỳ đã khóa.");
  return c;
}
const lateSql=`SELECT e.id,e.title,e.occurred_on::text AS "occurredOn",
  e.version AS "expenseVersion",e.total_minor::text AS "totalMinor",
  e.created_by AS "createdBy",
  occ.rule_id AS "recurringRuleId",occ.period::text AS "recurringPeriod",
  adj.target_cycle_id AS "assignedTargetId"
  FROM expenses e
  LEFT JOIN recurring_expense_occurrences occ ON occ.expense_id=e.id
  LEFT JOIN group_settlement_cycle_adjustments adj ON adj.expense_id=e.id
  WHERE e.group_id=$1 AND e.deleted_at IS NULL
    AND e.occurred_on >=$2::date AND e.occurred_on <$3::date
    AND (e.created_at>$4::timestamptz OR e.updated_at>$4::timestamptz)
    AND NOT EXISTS(SELECT 1 FROM group_settlement_cycle_snapshot_expenses se
      WHERE se.expense_id=e.id)
  ORDER BY e.occurred_on,e.created_at,e.id`;
const adjustmentSelect=`SELECT id,group_id AS "groupId",
  origin_cycle_id AS "originCycleId",target_cycle_id AS "targetCycleId",
  expense_id AS "expenseId",expense_version AS "expenseVersion",
  actor_id AS "actorId",request_key AS "requestKey",
  note,created_at AS "createdAt"
  FROM group_settlement_cycle_adjustments`;
const serialized=(r:Assignment)=>({...r,createdAt:r.createdAt.toISOString()});
async function earliestUnlocked(client:PoolClient,groupId:string,endDate:string) {
  const result=await client.query<{id:string;state:string;startDate:string;endDate:string}>(`
    SELECT id,state,period_start::text AS "startDate",
      period_end::text AS "endDate"
    FROM group_settlement_cycles
    WHERE group_id=$1 AND period_start>=$2::date
      AND state IN ('open','review')
    ORDER BY period_start,id LIMIT 1`,[groupId,endDate]);
  return result.rows[0]??null;
}

/** Late sources are original invoices only; no new expense/obligation is
 * created. A late recurring invoice has the same occurrence provenance.
 */
export async function listLateCycleAdjustments(groupId:string,originCycleId:string,
  actorId:string) {
  validateIds(groupId,originCycleId);
  const settings=await getSettlementSettings(groupId,actorId);
  const client=await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const c=await original(client,groupId,originCycleId);
    const rows=await client.query<LateRow>(lateSql,
      [groupId,c.periodStart,c.periodEnd,c.cutoffAt]);
    const target=await earliestUnlocked(client,groupId,c.periodEnd);
    await client.query("COMMIT");
    return {originCycleId,lateInvoices:rows.rows,
      total:rows.rowCount??0,eligibleTarget:target?.state==="review"?target:null,
      waitingForReview:Boolean(target&&target.state!=="review"),
      canManage:settings.canManage,financialEngineEnabled:false};
  }catch(e){await client.query("ROLLBACK");throw e;}
  finally{client.release();}
}
export type AssignLateInput={expenseId:string;targetCycleId:string;
  expectedExpenseVersion:number;requestKey:string;note?:string};
/** Any attribution commits one immutable audit source; the target REVIEW
 * snapshot will include the ORIGINAL debt at its actual source date, not
 * create another invoice. A concurrent lock of the target group/cycle
 * is serialized by withAuthorizedCycleManager and SQL triggers.
 */
export async function assignLateCycleInvoice(groupId:string,originCycleId:string,
  actorId:string,input:AssignLateInput) {
  validateIds(groupId,originCycleId,input?.expenseId);
  if(!input||!UUID.test(input.targetCycleId)||!UUID.test(input.requestKey)||
     !Number.isSafeInteger(input.expectedExpenseVersion)||
     input.expectedExpenseVersion<1||typeof(input.note??"")!=="string"||
     (input.note??"").length>500)
    throw fail(400,"Thông tin điều chỉnh hóa đơn không hợp lệ.");
  const note=(input.note??"").trim();
  try {
    return await withAuthorizedCycleManager(groupId,actorId,async client=>{
      const existing=await client.query<Assignment>(adjustmentSelect+
        " WHERE group_id=$1 AND actor_id=$2 AND request_key=$3 FOR UPDATE",
        [groupId,actorId,input.requestKey]);
      if(existing.rows[0]){
        const p=existing.rows[0];
        if(p.originCycleId!==originCycleId||
          p.targetCycleId!==input.targetCycleId||
          p.expenseId!==input.expenseId||
          p.expenseVersion!==input.expectedExpenseVersion||p.note!==note)
          throw fail(409,"Mã yêu cầu đã dùng cho điều chỉnh khác.");
        return {adjustment:serialized(p),alreadyAssigned:true,
          financialEngineEnabled:false};
      }
      const active=await client.query<{requested_enabled:boolean}>(
        "SELECT requested_enabled FROM group_settlement_settings WHERE group_id=$1",
        [groupId]);
      if(active.rows[0]?.requested_enabled!==true)
        throw fail(409,"Nhóm chưa bật quyết toán theo kỳ.");
      const origin=await original(client,groupId,originCycleId);
      const target=await earliestUnlocked(client,groupId,origin.periodEnd);
      if(!target||target.id!==input.targetCycleId||target.state!=="review")
        throw fail(409,"Chỉ được phân bổ vào kỳ sớm nhất đang chờ rà soát.");
      const invoice=await client.query<{version:number}>(`
        SELECT version FROM expenses WHERE id=$1 AND group_id=$2
          AND deleted_at IS NULL FOR UPDATE`,[input.expenseId,groupId]);
      if(invoice.rows[0]?.version!==input.expectedExpenseVersion)
        throw fail(409,"Hóa đơn đã thay đổi; tải lại trước khi điều chỉnh.");
      const inserted=await client.query<Assignment>(`
        INSERT INTO group_settlement_cycle_adjustments
          (id,group_id,origin_cycle_id,target_cycle_id,expense_id,
           expense_version,actor_id,request_key,note)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
        RETURNING id,group_id AS "groupId",origin_cycle_id AS "originCycleId",
          target_cycle_id AS "targetCycleId",expense_id AS "expenseId",
          expense_version AS "expenseVersion",actor_id AS "actorId",
          request_key AS "requestKey",note,created_at AS "createdAt"`,
        [randomUUID(),groupId,originCycleId,input.targetCycleId,
          input.expenseId,input.expectedExpenseVersion,actorId,
          input.requestKey,note]);
      return {adjustment:serialized(inserted.rows[0]),
        alreadyAssigned:false,financialEngineEnabled:false};
    });
  }catch(e) {
    if(e instanceof SettlementSettingsError)throw e;
    if(e&&typeof e==="object"&&"code" in e&&
      ["23505","23503","23514","P0001","40001","40P01"].includes(String(e.code)))
      throw fail(409,"Điều chỉnh không hợp lệ hoặc hóa đơn/kỳ đã thay đổi.");
    throw e;
  }
}
