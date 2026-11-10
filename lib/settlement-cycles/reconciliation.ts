import "server-only";
import {pool} from "@/lib/db/pool";
import type {PoolClient} from "pg";
import {SettlementSettingsError} from "@/lib/settlement-cycles/settings";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fail=(status:400|403|404|409,message:string)=>
  new SettlementSettingsError(status,message);
const ids=(groupId:string,cycleId:string)=>{
  if(!UUID.test(groupId)||!UUID.test(cycleId))throw fail(400,"Mã kỳ hoặc nhóm không hợp lệ.");
};
const MAX_EXPORT=20000;
const asMoney=(v:string)=>BigInt(v);
export type CycleReconciliation={
  cycleId:string;state:string;sourceCount:number;
  originalMinor:string;confirmedCashMinor:string;
  confirmedSetoffMinor:string;pendingCashMinor:string;
  outstandingMinor:string;availableMinor:string;
  unresolvedDisputes:number;pendingCashRequests:number;
  uncompletedInvoices:number;currentProposals:number;
  readyForManualReview:boolean;financialEngineEnabled:false;
};
export type CycleAuditEvent={
  id:string;kind:string;eventType:string;actorId:string|null;
  at:string;subjectId:string;description:string;
};
const auditUnion=`
 SELECT ev.id,'cycle' AS kind,ev.event_type AS "eventType",
    ev.actor_id AS "actorId",ev.recorded_at AS at,
    ev.cycle_id::text AS "subjectId",
    'Thay đổi trạng thái kỳ' AS description
 FROM group_settlement_cycle_events ev
 WHERE ev.group_id=$1 AND ev.cycle_id=$2
 UNION ALL
 SELECT p.id,'proposal','created',p.created_by,p.created_at,
    p.id::text,'Đề xuất bù trừ phi tiền mặt'
 FROM group_settlement_bilateral_proposals p
 WHERE p.group_id=$1 AND p.cycle_id=$2
   AND $3 IN(p.party_low,p.party_high)
 UNION ALL
 SELECT ev.id,'decision',ev.event_type,ev.actor_id,ev.recorded_at,
    ev.proposal_id::text,'Đồng thuận bù trừ hai người'
 FROM group_settlement_bilateral_decision_events ev
 WHERE ev.group_id=$1 AND ev.cycle_id=$2 AND
   $3 IN(ev.party_low,ev.party_high)
 UNION ALL
 SELECT app.id,'noncash','applied',app.applied_by,app.created_at,
   app.proposal_id::text,'Đã bù trừ phi tiền mặt, không chuyển khoản'
 FROM group_settlement_bilateral_applications app
 WHERE app.group_id=$1 AND app.cycle_id=$2
   AND $3 IN(app.party_low,app.party_high)
 UNION ALL
 SELECT e.id,'cash',e.event_type,e.actor_id,e.recorded_at,
   e.settlement_id::text,'Yêu cầu/đồng thuận thanh toán tiền mặt'
 FROM settlement_events e
 JOIN group_settlement_cycle_repayments cr ON cr.settlement_id=e.settlement_id
 WHERE cr.group_id=$1 AND cr.cycle_id=$2
   AND $3 IN(cr.debtor_id,cr.creditor_id)
 UNION ALL
 SELECT adj.id,'late_invoice','attributed',adj.actor_id,adj.created_at,
   adj.expense_id::text,'Hóa đơn gốc nhập muộn được gán kỳ'
 FROM group_settlement_cycle_adjustments adj
 WHERE adj.group_id=$1 AND adj.target_cycle_id=$2
 UNION ALL
 SELECT d.id,'dispute','opened',d.reporter_id,d.created_at,
   d.obligation_id::text,'Tranh chấp nghĩa vụ gốc, không sửa tiền'
 FROM group_settlement_cycle_disputes d
 WHERE d.group_id=$1 AND d.cycle_id=$2
   AND $3 IN(d.reporter_id,d.counterparty_id)
 UNION ALL
 SELECT ev.id,'dispute',ev.event_type,ev.actor_id,ev.recorded_at,
   ev.dispute_id::text,'Trao đổi và đối soát tranh chấp'
 FROM group_settlement_cycle_dispute_events ev
 JOIN group_settlement_cycle_disputes d ON d.id=ev.dispute_id
 WHERE d.group_id=$1 AND d.cycle_id=$2
   AND $3 IN(d.reporter_id,d.counterparty_id)
`;
async function withRead<T>(groupId:string,cycleId:string,actorId:string,
 work:(c:PoolClient,cycleState:string)=>Promise<T>):Promise<T>{
  ids(groupId,cycleId);
  const c=await pool.connect();
  try{
    await c.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const r=await c.query<{state:string}>(`
      SELECT cy.state FROM group_settlement_cycles cy
      JOIN groups g ON g.id=cy.group_id AND g.archived_at IS NULL
      JOIN group_members m ON m.group_id=cy.group_id
        AND m.user_id=$3 AND m.status='active'
      WHERE cy.group_id=$1 AND cy.id=$2`,[groupId,cycleId,actorId]);
    if(!r.rows[0])throw fail(404,"Không tìm thấy kỳ hoặc bạn không thuộc nhóm.");
    const value=await work(c,r.rows[0].state);
    await c.query("COMMIT");return value;
  }catch(e){await c.query("ROLLBACK");throw e;}
  finally{c.release();}
}
async function summary(c:PoolClient,groupId:string,cycleId:string){
  const r=await c.query<{
    sourceCount:number;originalMinor:string;confirmedCashMinor:string;
    confirmedSetoffMinor:string;pendingCashMinor:string;
    outstandingMinor:string;availableMinor:string;
  }>(`SELECT count(*)::int AS "sourceCount",
     coalesce(sum(b.original_minor),0)::text AS "originalMinor",
     coalesce(sum(b.confirmed_cash_minor),0)::text AS "confirmedCashMinor",
     coalesce(sum(b.confirmed_setoff_minor),0)::text AS "confirmedSetoffMinor",
     coalesce(sum(b.pending_cash_minor),0)::text AS "pendingCashMinor",
     coalesce(sum(b.outstanding_minor),0)::text AS "outstandingMinor",
     coalesce(sum(b.available_minor),0)::text AS "availableMinor"
     FROM group_settlement_cycle_snapshot_obligations so
     JOIN bn005_obligation_balances b ON b.obligation_id=so.obligation_id
     WHERE so.group_id=$1 AND so.cycle_id=$2`,[groupId,cycleId]);
  return r.rows[0];
}
export async function readCycleReconciliation(groupId:string,cycleId:string,actorId:string){
  return withRead(groupId,cycleId,actorId,async(c,state)=>{
    const money=await summary(c,groupId,cycleId);
    if(asMoney(money.originalMinor)-asMoney(money.confirmedCashMinor)-
       asMoney(money.confirmedSetoffMinor)!==asMoney(money.outstandingMinor)||
       asMoney(money.outstandingMinor)-asMoney(money.pendingCashMinor)
       !==asMoney(money.availableMinor)||asMoney(money.availableMinor)<0n)
       throw fail(409,"Sổ công nợ gốc không cân bằng, cần đối soát trước.");
    const checks=await c.query<{unresolvedDisputes:number;
      pendingCashRequests:number;uncompletedInvoices:number;
      currentProposals:number}>(`
      SELECT
       (SELECT count(*)::int FROM sc009_dispute_states d
        WHERE d.group_id=$1 AND d.cycle_id=$2
          AND d.status IN('open','awaiting_reporter'))
         AS "unresolvedDisputes",
       (SELECT count(*)::int FROM group_settlement_cycle_repayments cr
        JOIN settlements s ON s.id=cr.settlement_id
        WHERE cr.group_id=$1 AND cr.cycle_id=$2 AND s.status='pending')
         AS "pendingCashRequests",
       (SELECT count(*)::int FROM group_settlement_cycle_snapshot_expenses se
        JOIN expenses e ON e.id=se.expense_id
        WHERE se.group_id=$1 AND se.cycle_id=$2 AND e.completed_at IS NULL)
         AS "uncompletedInvoices",
       (SELECT count(*)::int FROM group_settlement_bilateral_heads h
        JOIN group_settlement_bilateral_proposals p ON p.id=h.current_proposal_id
        WHERE h.group_id=$1 AND h.cycle_id=$2
          AND p.created_at>now()-interval '72 hours'
          AND NOT EXISTS(SELECT 1 FROM group_settlement_bilateral_applications app
            WHERE app.proposal_id=p.id)
          AND NOT EXISTS(SELECT 1 FROM group_settlement_bilateral_decision_events ev
            WHERE ev.proposal_id=p.id AND ev.event_type IN
              ('reject','revoke','invalidated','expired')))
         AS "currentProposals"`,[groupId,cycleId]);
    const v=checks.rows[0];
    return {cycleId,state,...money,...v,
      readyForManualReview:state==="locked"&&
        asMoney(money.outstandingMinor)===0n&&v.unresolvedDisputes===0&&
        v.pendingCashRequests===0&&v.uncompletedInvoices===0&&
        v.currentProposals===0,
      financialEngineEnabled:false} satisfies CycleReconciliation;
  });
}
export async function listCycleAudit(groupId:string,cycleId:string,actorId:string,
 page:number,forExport=false){
  if(!Number.isSafeInteger(page)||page<1||page>100000)
    throw fail(400,"Trang lịch sử không hợp lệ.");
  return withRead(groupId,cycleId,actorId,async c=>{
    const total=await c.query<{n:number}>(`SELECT count(*)::int AS n
      FROM (${auditUnion}) events`,[groupId,cycleId,actorId]);
    const count=total.rows[0]?.n??0;
    if(forExport&&count>MAX_EXPORT)throw fail(409,"Lịch sử vượt 20.000 sự kiện. Cần xuất theo phạm vi nhỏ hơn.");
    const limit=forExport?MAX_EXPORT:50,offset=forExport?0:(page-1)*50;
    const items=await c.query<{id:string;kind:string;eventType:string;
      actorId:string|null;at:Date;subjectId:string;description:string}>(`
      SELECT * FROM (${auditUnion}) events
      ORDER BY at DESC,id DESC LIMIT $4 OFFSET $5`,
      [groupId,cycleId,actorId,limit,offset]);
    return {items:items.rows.map(v=>({...v,at:v.at.toISOString()})),
      page,total:count,totalPages:Math.max(1,Math.ceil(count/50)),
      financialEngineEnabled:false};
  });
}
export async function exportCycleCsv(groupId:string,cycleId:string,actorId:string,
 kind:"ledger"|"audit"):Promise<string>{
  if(kind==="audit"){
    const history=await listCycleAudit(groupId,cycleId,actorId,1,true);
    return csv(["Thời điểm","Loại","Sự kiện","Người thực hiện",
      "Mã chứng từ","Mã nguồn","Diễn giải"],history.items.map(e=>
      [e.at,e.kind,e.eventType,e.actorId??"Hệ thống",e.id,e.subjectId,e.description]));
  }
  return withRead(groupId,cycleId,actorId,async(c,state)=>{
    if(state!=="locked")throw fail(409,"Chỉ xuất nghĩa vụ của kỳ đã khóa.");
    const totals=await summary(c,groupId,cycleId);
    if(totals.sourceCount>MAX_EXPORT)throw fail(409,
      "Kỳ có trên 20.000 nghĩa vụ; không được xuất thiếu dữ liệu.");
    const rows=await c.query<{id:string;invoice:string;date:string;
      debtor:string;creditor:string;original:string;cash:string;
      noncash:string;pending:string;remaining:string;available:string;
      late:boolean}>(`SELECT so.obligation_id::text AS id,
      e.title AS invoice,e.occurred_on::text AS date,
      so.debtor_id AS debtor,so.creditor_id AS creditor,
      b.original_minor::text AS original,
      b.confirmed_cash_minor::text AS cash,
      b.confirmed_setoff_minor::text AS noncash,
      b.pending_cash_minor::text AS pending,
      b.outstanding_minor::text AS remaining,
      b.available_minor::text AS available,
      (adj.id IS NOT NULL) AS late
      FROM group_settlement_cycle_snapshot_obligations so
      JOIN expenses e ON e.id=so.expense_id AND e.group_id=so.group_id
      JOIN bn005_obligation_balances b ON b.obligation_id=so.obligation_id
      LEFT JOIN group_settlement_cycle_adjustments adj
        ON adj.expense_id=so.expense_id AND adj.target_cycle_id=so.cycle_id
      WHERE so.group_id=$1 AND so.cycle_id=$2
      ORDER BY e.occurred_on,so.obligation_id`,[groupId,cycleId]);
    return csv(["Mã nghĩa vụ","Hóa đơn gốc","Ngày phát sinh","Người nợ",
      "Người nhận","Nợ gốc (VND)","Tiền đã xác nhận (VND)",
      "Bù trừ phi tiền mặt (VND)","Tiền đang chờ (VND)",
      "Nợ còn lại (VND)","Khả dụng (VND)","Hóa đơn nhập muộn"],
      rows.rows.map(v=>[v.id,v.invoice,v.date,v.debtor,v.creditor,
        v.original,v.cash,v.noncash,v.pending,v.remaining,
        v.available,v.late?"Có":"Không"]));
  });
}
/** RFC4180 CSV with spreadsheet-formula neutralization for user text. */
export function csv(headers:string[],rows:(string|number|null)[][]){
  const escape=(v:string|number|null)=>{
    const raw=String(v??"");
    const safe=/^[\s\u0000-\u001f]*[=+@-]/u.test(raw)?"'"+raw:raw;
    return '"'+safe.replaceAll('"','""')+'"';
  };
  return "\uFEFF"+[headers,...rows].map(r=>r.map(escape).join(",")).join("\r\n")+"\r\n";
}
