import "server-only";
import {pool} from "@/lib/db/pool";
import {getSettlementSettings,SettlementSettingsError} from "@/lib/settlement-cycles/settings";
import type {CycleRecord} from "@/lib/settlement-cycles/lifecycle";

/** SC-008 READ-ONLY projection. Original obligation IDs and invoice links
 * are never replaced by a cycle "bill". Live CASH and NONCASH are separate.
 * Only active group members may view a group/cycle source. All totals are
 * from original PostgreSQL rows, never paginated UI sums.
 */
export type CycleSourceLine={
  obligationId:string;expenseId:string;expenseTitle:string;occurredOn:string;
  debtorId:string;creditorId:string;createdBy:string;
  originalMinor:string;confirmedCashMinor:string;confirmedSetoffMinor:string;
  pendingCashMinor:string;outstandingMinor:string;availableMinor:string;
  attributedLate:boolean;invoiceCompleted:boolean;
};
export type CycleSourceTotals={
  sourceCount:number;originalMinor:string;cashMinor:string;noncashMinor:string;
  pendingCashMinor:string;outstandingMinor:string;availableMinor:string;
};
export type CycleSourcePage={lines:CycleSourceLine[];totals:CycleSourceTotals;
  page:number;pageSize:50;totalPages:number;};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const invalid=(status:400|403|404|409,message:string)=>
  new SettlementSettingsError(status,message);
export async function readCycleSources(groupId:string,cycle:CycleRecord,
  actorId:string,page:number):Promise<CycleSourcePage>{
  if(!UUID.test(groupId)||!UUID.test(cycle.id)||
     !Number.isSafeInteger(page)||page<1||page>100000)
    throw invalid(400,"Tham số trang nguồn công nợ không hợp lệ.");
  // Existing group setting lookup is membership-gated, independent of
  // whether the group opted into settlement cycles.
  await getSettlementSettings(groupId,actorId);
  if(cycle.groupId!==groupId||cycle.state!=="locked")
    throw invalid(409,"Chỉ xem nghĩa vụ gốc của kỳ đã khóa.");
  const client=await pool.connect();
  try{
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const member=await client.query(`
      SELECT 1 FROM group_members m JOIN groups g ON g.id=m.group_id
      WHERE m.group_id=$1 AND m.user_id=$2 AND m.status='active'
        AND g.archived_at IS NULL`,[groupId,actorId]);
    if(!member.rowCount)throw invalid(404,"Không tìm thấy nhóm đang hoạt động.");
    const scoped=await client.query(`
      SELECT 1 FROM group_settlement_cycles c WHERE c.id=$1 AND c.group_id=$2
       AND c.state='locked'`,[cycle.id,groupId]);
    if(!scoped.rowCount)throw invalid(404,"Không tìm thấy kỳ đã khóa.");

    const summary=await client.query<{
      sourceCount:number;originalMinor:string;cashMinor:string;
      noncashMinor:string;pendingCashMinor:string;outstandingMinor:string;
      availableMinor:string;
    }>(`SELECT count(*)::int AS "sourceCount",
       coalesce(sum(b.original_minor),0)::text AS "originalMinor",
       coalesce(sum(b.confirmed_cash_minor),0)::text AS "cashMinor",
       coalesce(sum(b.confirmed_setoff_minor),0)::text AS "noncashMinor",
       coalesce(sum(b.pending_cash_minor),0)::text AS "pendingCashMinor",
       coalesce(sum(b.outstanding_minor),0)::text AS "outstandingMinor",
       coalesce(sum(b.available_minor),0)::text AS "availableMinor"
      FROM group_settlement_cycle_snapshot_obligations src
      JOIN obligations o ON o.id=src.obligation_id AND o.group_id=src.group_id
      JOIN bn005_obligation_balances b ON b.obligation_id=o.id
      WHERE src.group_id=$1 AND src.cycle_id=$2 AND o.voided_at IS NULL`,
      [groupId,cycle.id]);
    const totals=summary.rows[0];
    if(BigInt(totals.originalMinor)-BigInt(totals.cashMinor)-
       BigInt(totals.noncashMinor)!==BigInt(totals.outstandingMinor)||
       BigInt(totals.outstandingMinor)-BigInt(totals.pendingCashMinor)
          !==BigInt(totals.availableMinor)||
       BigInt(totals.availableMinor)<0n)
      throw invalid(409,"Công nợ gốc không cân bằng, cần đối soát.");
    const result=await client.query<CycleSourceLine>(`
      SELECT src.obligation_id AS "obligationId",
        src.expense_id AS "expenseId",e.title AS "expenseTitle",
        e.occurred_on::text AS "occurredOn",
        src.debtor_id AS "debtorId",src.creditor_id AS "creditorId",
        e.created_by AS "createdBy",
        b.original_minor::text AS "originalMinor",
        b.confirmed_cash_minor::text AS "confirmedCashMinor",
        b.confirmed_setoff_minor::text AS "confirmedSetoffMinor",
        b.pending_cash_minor::text AS "pendingCashMinor",
        b.outstanding_minor::text AS "outstandingMinor",
        b.available_minor::text AS "availableMinor",
        (adj.id IS NOT NULL) AS "attributedLate",
        (e.completed_at IS NOT NULL) AS "invoiceCompleted"
      FROM group_settlement_cycle_snapshot_obligations src
      JOIN obligations o ON o.id=src.obligation_id AND o.group_id=src.group_id
      JOIN expenses e ON e.id=src.expense_id AND e.group_id=src.group_id
      JOIN bn005_obligation_balances b ON b.obligation_id=o.id
      LEFT JOIN group_settlement_cycle_adjustments adj
        ON adj.expense_id=src.expense_id
          AND adj.group_id=src.group_id AND adj.target_cycle_id=src.cycle_id
      WHERE src.group_id=$1 AND src.cycle_id=$2 AND o.voided_at IS NULL
      ORDER BY e.occurred_on,src.obligation_id
      LIMIT 50 OFFSET $3`,[groupId,cycle.id,(page-1)*50]);
    await client.query("COMMIT");
    return {lines:result.rows,totals,page,pageSize:50,
      totalPages:Math.max(1,Math.ceil(totals.sourceCount/50))};
  }catch(e){await client.query("ROLLBACK");throw e;}
  finally{client.release();}
}
