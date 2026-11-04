import "server-only";
import {createHash,randomUUID} from "node:crypto";
import {pool} from "@/lib/db/pool";
import {getSettlementSettings,SettlementSettingsError,
  withAuthorizedCycleManager} from "@/lib/settlement-cycles/settings";
import type {PoolClient} from "pg";

/**
 * SC-004: canonical live obligation SQL at the instant of locking.
 * NEVER use the listGroupDebts (500) or listExpenses (100) API for totals.
 * All money is read as strings and accumulated with bigint / PG numeric.
 * Pending cash is RESERVED, not confirmed. No set-off exists yet.
 */
const validUUID=(s:unknown):s is string=>typeof s==="string"&&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
const fail=(status:400|403|404|409,message:string)=>
  new SettlementSettingsError(status,message);

type DbCycle={id:string;groupId:string;state:string;version:number;
  startDate:string;endDate:string;endAt:Date;lockedAt:Date|null};
type DbCashRow={
  obligationId:string;expenseId:string;expenseVersion:number;
  debtorId:string;creditorId:string;originalMinor:string;
  confirmedCashMinor:string;pendingCashMinor:string;
  outstandingMinor:string;availableMinor:string;
};
type DbExpenseRow={expenseId:string;expenseVersion:number;
  occurredOn:string;totalMinor:string};
export type SnapshotTotals={
  expenseCount:number;obligationCount:number;
  originalMinor:string;confirmedCashMinor:string;
  pendingCashMinor:string;outstandingMinor:string;availableMinor:string;
};
export type LockedSnapshot=SnapshotTotals & {
  cycleId:string;requestKey:string;lockedBy:string;cutoffAt:string;
  sealedAt:string;fingerprint:string;state:"locked";
};
export type EligibilityPreview=SnapshotTotals & {
  cycleId:string;state:"review";previewOnly:true;lateExpenseCount:0;
  calculatedAt:string;fingerprint:string;
};
type SnapshotDb=Omit<LockedSnapshot,"state"|"cutoffAt"|"sealedAt"> &
  {cutoffAt:Date;sealedAt:Date};

/** Payment allocations are aggregated PER obligation and statuses strictly
 * filtered. Group/expense scope comes from obligations+expenses and cycle,
 * not from the logged-in user's UI list or from user-supplied dates.
 * The cutoff excludes obligations created after the read boundary.
 */
const candidateObligations=`
  SELECT o.id AS "obligationId",o.expense_id AS "expenseId",
    o.expense_version AS "expenseVersion",o.debtor_id AS "debtorId",
    o.creditor_id AS "creditorId",o.amount_minor::text AS "originalMinor",
    COALESCE(pay.confirmed,0)::text AS "confirmedCashMinor",
    COALESCE(pay.pending,0)::text AS "pendingCashMinor",
    (o.amount_minor::numeric-COALESCE(pay.confirmed,0))::text AS "outstandingMinor",
    (o.amount_minor::numeric-COALESCE(pay.confirmed,0)-COALESCE(pay.pending,0))::text
      AS "availableMinor"
  FROM obligations o
  JOIN expenses e ON e.id=o.expense_id AND e.group_id=o.group_id
  LEFT JOIN LATERAL (
    SELECT SUM(a.amount_minor) FILTER(WHERE s.status='confirmed') AS confirmed,
      SUM(a.amount_minor) FILTER(WHERE s.status='pending') AS pending
    FROM settlement_allocations a
    JOIN settlements s ON s.id=a.settlement_id AND s.group_id=o.group_id
    WHERE a.obligation_id=o.id
  ) pay ON true
  WHERE o.group_id=$1 AND e.deleted_at IS NULL AND o.voided_at IS NULL
    AND e.occurred_on >= $2::date AND e.occurred_on < $3::date
    AND e.created_at <= $4::timestamptz AND o.created_at <= $4::timestamptz
`;
const candidateExpenses=`
  SELECT e.id AS "expenseId",e.version AS "expenseVersion",
    e.occurred_on::text AS "occurredOn",e.total_minor::text AS "totalMinor"
  FROM expenses e
  WHERE e.group_id=$1 AND e.deleted_at IS NULL
    AND e.occurred_on >= $2::date AND e.occurred_on < $3::date
    AND e.created_at <= $4::timestamptz
`;
const selectCycle=`SELECT c.id,c.group_id AS "groupId",
  c.state,c.version,c.period_start::text AS "startDate",
  c.period_end::text AS "endDate",c.end_at AS "endAt",
  c.locked_at AS "lockedAt"
  FROM group_settlement_cycles c WHERE c.group_id=$1 AND c.id=$2`;
const zero=()=>({expenseCount:0,obligationCount:0,
  originalMinor:"0",confirmedCashMinor:"0",pendingCashMinor:"0",
  outstandingMinor:"0",availableMinor:"0"});
function fold(expenses:readonly DbExpenseRow[],rows:readonly DbCashRow[]):SnapshotTotals{
  const sums={originalMinor:0n,confirmedCashMinor:0n,
    pendingCashMinor:0n,outstandingMinor:0n,availableMinor:0n};
  for(const row of rows){
    const original=BigInt(row.originalMinor),paid=BigInt(row.confirmedCashMinor);
    const pending=BigInt(row.pendingCashMinor);
    if(original<=0n||paid<0n||pending<0n||paid+pending>original||
       BigInt(row.outstandingMinor)!==original-paid||
       BigInt(row.availableMinor)!==original-paid-pending){
      throw fail(409,
        "Sổ công nợ không cân bằng hoặc thanh toán đang chờ vượt nghĩa vụ.");
    }
    for(const field of Object.keys(sums) as (keyof typeof sums)[])
      sums[field]+=BigInt(row[field]);
  }
  return {
    expenseCount:expenses.length,obligationCount:rows.length,
    originalMinor:sums.originalMinor.toString(),
    confirmedCashMinor:sums.confirmedCashMinor.toString(),
    pendingCashMinor:sums.pendingCashMinor.toString(),
    outstandingMinor:sums.outstandingMinor.toString(),
    availableMinor:sums.availableMinor.toString(),
  };
}
function fingerprint(expenses:readonly DbExpenseRow[],rows:readonly DbCashRow[]){
  const hash=createHash("sha256").update("sc004_snapshot_v1\n");
  for(const e of expenses){
    hash.update(JSON.stringify(["e",e.expenseId,e.expenseVersion,
      e.occurredOn,e.totalMinor])+"\n");
  }
  for(const o of rows)hash.update(JSON.stringify([
    "o",o.obligationId,o.expenseId,o.expenseVersion,
    o.debtorId,o.creditorId,o.originalMinor,o.confirmedCashMinor,
    o.pendingCashMinor,o.outstandingMinor,o.availableMinor,
  ])+"\n");
  return hash.digest("hex");
}
async function readCanonical(client:PoolClient,c:DbCycle,cutoff:Date){
  const params=[c.groupId,c.startDate,c.endDate,cutoff.toISOString()];
  const expenses=await client.query<DbExpenseRow>(
    candidateExpenses+" ORDER BY e.occurred_on,e.id",params);
  const obligations=await client.query<DbCashRow>(
    candidateObligations+" ORDER BY e.occurred_on,e.id,o.id",params);
  const totals=fold(expenses.rows,obligations.rows);
  return {expenses:expenses.rows,obligations:obligations.rows,
    totals,fingerprint:fingerprint(expenses.rows,obligations.rows)};
}
const snapshotQuery=`SELECT cycle_id AS "cycleId",request_key AS "requestKey",
  locked_by AS "lockedBy",cutoff_at AS "cutoffAt",sealed_at AS "sealedAt",
  expense_count AS "expenseCount",obligation_count AS "obligationCount",
  original_minor::text AS "originalMinor",
  confirmed_cash_minor::text AS "confirmedCashMinor",
  pending_cash_minor::text AS "pendingCashMinor",
  outstanding_minor::text AS "outstandingMinor",
  available_minor::text AS "availableMinor",fingerprint
  FROM group_settlement_cycle_snapshots`;
function snapshotRecord(row:SnapshotDb):LockedSnapshot{
  return {...row,cutoffAt:row.cutoffAt.toISOString(),
    sealedAt:row.sealedAt.toISOString(),state:"locked"};
}

/** Only a member can read this preview; it can change until the lock commits.
 * One read-only transaction with repeatable-read snapshot avoids mixed-time
 * expense vs cash reads in the preliminary preview.
 */
export async function inspectCycleSnapshot(groupId:string,cycleId:string,
  actorId:string):Promise<EligibilityPreview|LockedSnapshot|null>{
  if(!validUUID(groupId)||!validUUID(cycleId))
    throw fail(400,"Mã nhóm hoặc kỳ không hợp lệ.");
  const permissions=await getSettlementSettings(groupId,actorId);
  const client=await pool.connect();
  try{
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const res=await client.query<DbCycle>(selectCycle,[groupId,cycleId]);
    const c=res.rows[0];
    if(!c)throw fail(404,"Không tìm thấy kỳ.");
    const locked=await client.query<SnapshotDb>(
      snapshotQuery+" WHERE group_id=$1 AND cycle_id=$2",[groupId,cycleId]);
    if(c.state==="locked"){
      if(!locked.rows[0])throw fail(409,"Kỳ khóa thiếu chứng từ snapshot.");
      await client.query("COMMIT");
      return snapshotRecord(locked.rows[0]);
    }
    if(c.state!=="review")return null;
    const at=await client.query<{now:Date}>("SELECT clock_timestamp() AS now");
    const details=await readCanonical(client,c,at.rows[0].now);
    await client.query("COMMIT");
    return {...details.totals,cycleId,state:"review",previewOnly:true,
      lateExpenseCount:0,calculatedAt:at.rows[0].now.toISOString(),
      fingerprint:details.fingerprint};
  }catch(e){await client.query("ROLLBACK");throw e;}
  finally{client.release();}
}

/** Snapshot and LOCKED transition commit atomically under the SC-001 group
 * lock used by ALL invoice and cash writers. No financial tables are updated.
 * The persisted snapshot is an immutable AS-OF claim, not the live balance;
 * later cash confirmations must still be reconciled in SC-005+.
 */
export async function lockCycleSnapshot(groupId:string,cycleId:string,
  actorId:string,expectedVersion:number,requestKey:string,
  expectedFingerprint:string):Promise<LockedSnapshot>{
  if(!validUUID(groupId)||!validUUID(cycleId)||!validUUID(requestKey)||
     !Number.isSafeInteger(expectedVersion)||expectedVersion!==2||
     typeof expectedFingerprint!=="string"||
     !/^[0-9a-f]{64}$/.test(expectedFingerprint))
    throw fail(400,"Mã yêu cầu hoặc phiên bản kỳ không hợp lệ.");
  return withAuthorizedCycleManager(groupId,actorId,async client=>{
    const setting=await client.query<{requested_enabled:boolean}>(
      "SELECT requested_enabled FROM group_settlement_settings WHERE group_id=$1",
      [groupId]);
    if(setting.rows[0]?.requested_enabled!==true)
      throw fail(409,"Nhóm đã tắt chế độ quyết toán; không thể khóa kỳ.");
    const cycleQuery=await client.query<DbCycle>(
      selectCycle+" FOR UPDATE",[groupId,cycleId]);
    const c=cycleQuery.rows[0];
    if(!c)throw fail(404,"Không tìm thấy kỳ quyết toán.");
    const prior=await client.query<SnapshotDb>(
      snapshotQuery+" WHERE group_id=$1 AND request_key=$2 FOR UPDATE",
      [groupId,requestKey]);
    if(prior.rows[0]){
      if(prior.rows[0].cycleId!==cycleId||prior.rows[0].lockedBy!==actorId||
         prior.rows[0].fingerprint!==expectedFingerprint)
        throw fail(409,"Mã yêu cầu đã dùng cho một snapshot khác.");
      if(c.state!=="locked")throw fail(409,"Snapshot đã ghi nhưng kỳ chưa ở trạng thái khóa.");
      return snapshotRecord(prior.rows[0]);
    }
    if(c.state!=="review"||c.version!==expectedVersion)
      throw fail(409,"Kỳ không còn chờ rà soát hoặc phiên bản đã thay đổi.");
    const clock=await client.query<{now:Date}>(
      "SELECT clock_timestamp() AS now");
    const cutoff=clock.rows[0].now;
    if(c.endAt.getTime()>cutoff.getTime())
      throw fail(409,"Không được khóa kỳ trước thời điểm kết thúc.");
    const details=await readCanonical(client,c,cutoff);
    if(details.fingerprint!==expectedFingerprint)
      throw fail(409,
        "Số liệu hóa đơn hoặc thanh toán đã thay đổi. Phải kiểm tra lại trước khi khóa.");
    const params=[groupId,c.startDate,c.endDate,cutoff.toISOString(),cycleId];
    const expenseInsert=await client.query(
      `INSERT INTO group_settlement_cycle_snapshot_expenses
        (cycle_id,group_id,expense_id,expense_version,occurred_on,
         created_at,payer_id,created_by,total_minor,completed_at)
       SELECT $5,e.group_id,e.id,e.version,e.occurred_on,
         e.created_at,e.payer_id,e.created_by,e.total_minor,e.completed_at
       FROM expenses e
       WHERE e.group_id=$1 AND e.deleted_at IS NULL
         AND e.occurred_on >= $2::date AND e.occurred_on < $3::date
         AND e.created_at <= $4::timestamptz
       ORDER BY e.occurred_on,e.id`,params);
    const obligationInsert=await client.query(
      `INSERT INTO group_settlement_cycle_snapshot_obligations
        (cycle_id,group_id,obligation_id,expense_id,expense_version,
         debtor_id,creditor_id,original_minor,confirmed_cash_minor,
         pending_cash_minor,outstanding_minor,available_minor)
       SELECT $5,o.group_id,o.id,o.expense_id,o.expense_version,
         o.debtor_id,o.creditor_id,o.amount_minor,
         COALESCE(pay.confirmed,0),COALESCE(pay.pending,0),
         o.amount_minor::numeric-COALESCE(pay.confirmed,0),
         o.amount_minor::numeric-COALESCE(pay.confirmed,0)-COALESCE(pay.pending,0)
       FROM obligations o
       JOIN expenses e ON e.id=o.expense_id AND e.group_id=o.group_id
       LEFT JOIN LATERAL (
         SELECT SUM(a.amount_minor) FILTER(WHERE s.status='confirmed') AS confirmed,
           SUM(a.amount_minor) FILTER(WHERE s.status='pending') AS pending
         FROM settlement_allocations a
         JOIN settlements s ON s.id=a.settlement_id AND s.group_id=o.group_id
         WHERE a.obligation_id=o.id
       ) pay ON true
       WHERE o.group_id=$1 AND e.deleted_at IS NULL AND o.voided_at IS NULL
         AND e.occurred_on >= $2::date AND e.occurred_on < $3::date
         AND e.created_at <= $4::timestamptz AND o.created_at <= $4::timestamptz
       ORDER BY e.occurred_on,e.id,o.id`,params);
    if(expenseInsert.rowCount!==details.totals.expenseCount||
       obligationInsert.rowCount!==details.totals.obligationCount)
      throw fail(409,"Số dòng snapshot không khớp, giao dịch đã rollback.");
    // Verify actual persisted rows, not just a preview SELECT or inserted
    // row count. If any writer bypassed the documented group-lock protocol,
    // a changed version/payment amount causes a full transaction rollback.
    const persistedExpenses=await client.query<DbExpenseRow>(
      `SELECT expense_id AS "expenseId",expense_version AS "expenseVersion",
         occurred_on::text AS "occurredOn",total_minor::text AS "totalMinor"
       FROM group_settlement_cycle_snapshot_expenses
       WHERE cycle_id=$1 ORDER BY occurred_on,expense_id`,[cycleId]);
    const persistedObligations=await client.query<DbCashRow>(
      `SELECT o.obligation_id AS "obligationId",
         o.expense_id AS "expenseId",o.expense_version AS "expenseVersion",
         o.debtor_id AS "debtorId",o.creditor_id AS "creditorId",
         o.original_minor::text AS "originalMinor",
         o.confirmed_cash_minor::text AS "confirmedCashMinor",
         o.pending_cash_minor::text AS "pendingCashMinor",
         o.outstanding_minor::text AS "outstandingMinor",
         o.available_minor::text AS "availableMinor"
       FROM group_settlement_cycle_snapshot_obligations o
       JOIN group_settlement_cycle_snapshot_expenses e
         ON e.cycle_id=o.cycle_id AND e.expense_id=o.expense_id
       WHERE o.cycle_id=$1 ORDER BY e.occurred_on,e.expense_id,o.obligation_id`,
      [cycleId],
    );
    const checkTotals=fold(persistedExpenses.rows,persistedObligations.rows);
    if(fingerprint(persistedExpenses.rows,persistedObligations.rows)!==
         details.fingerprint||
       JSON.stringify(checkTotals)!==JSON.stringify(details.totals))
      throw fail(409,"Bản snapshot đã ghi không khớp dữ liệu gốc. Giao dịch đã rollback.");
    const t=checkTotals;
    const insert=await client.query<SnapshotDb>(
      `INSERT INTO group_settlement_cycle_snapshots
        (cycle_id,group_id,request_key,locked_by,cutoff_at,
         expense_count,obligation_count,original_minor,
         confirmed_cash_minor,pending_cash_minor,outstanding_minor,
         available_minor,fingerprint)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING cycle_id AS "cycleId",request_key AS "requestKey",
         locked_by AS "lockedBy",cutoff_at AS "cutoffAt",
         sealed_at AS "sealedAt",expense_count AS "expenseCount",
         obligation_count AS "obligationCount",original_minor::text AS "originalMinor",
         confirmed_cash_minor::text AS "confirmedCashMinor",
         pending_cash_minor::text AS "pendingCashMinor",
         outstanding_minor::text AS "outstandingMinor",
         available_minor::text AS "availableMinor",fingerprint`,
      [cycleId,groupId,requestKey,actorId,cutoff.toISOString(),
        t.expenseCount,t.obligationCount,t.originalMinor,t.confirmedCashMinor,
        t.pendingCashMinor,t.outstandingMinor,t.availableMinor,
        details.fingerprint],
    );
    const changed=await client.query(
      `UPDATE group_settlement_cycles
       SET state='locked',version=version+1,
         locked_at=clock_timestamp(),locked_by=$3,updated_at=clock_timestamp()
       WHERE group_id=$1 AND id=$2 AND state='review' AND version=$4
       RETURNING id`,
      [groupId,cycleId,actorId,expectedVersion],
    );
    if(changed.rowCount!==1)throw fail(409,"Kỳ đã thay đổi, không thể khóa.");
    await client.query(
      `INSERT INTO group_settlement_cycle_events
       (id,group_id,cycle_id,event_type,initiator,actor_id,
        from_state,to_state,cycle_version,details)
       VALUES($1,$2,$3,'snapshot_locked','member',$4,
              'review','locked',3,$5::jsonb)`,
      [randomUUID(),groupId,cycleId,actorId,
       JSON.stringify({requestKey,cutoffAt:cutoff.toISOString(),
         fingerprint:details.fingerprint,expenseCount:t.expenseCount,
         obligationCount:t.obligationCount,financialSettlement:false})],
    );
    return snapshotRecord(insert.rows[0]);
  });
}

/** Read-only, limit-independent reconciliation signal: expenses that appeared
 * AFTER the snapshot cutoff for the same historic date range. SC-006 defines
 * adjustments; SC-004 must not mutate a locked snapshot or auto-reassign debt.
 */
export async function countLateCycleExpenses(groupId:string,cycleId:string,
  actorId:string):Promise<number>{
  if(!validUUID(groupId)||!validUUID(cycleId))
    throw fail(400,"Mã nhóm hoặc kỳ không hợp lệ.");
  await getSettlementSettings(groupId,actorId);
  const r=await pool.query<{count:number}>(
    `SELECT count(*)::int AS count
      FROM group_settlement_cycles c
      JOIN group_settlement_cycle_snapshots s ON s.cycle_id=c.id
      JOIN expenses e ON e.group_id=c.group_id
        AND e.occurred_on>=c.period_start AND e.occurred_on<c.period_end
        AND e.deleted_at IS NULL
        AND NOT EXISTS(SELECT 1 FROM group_settlement_cycle_snapshot_expenses se
          WHERE se.cycle_id=c.id AND se.expense_id=e.id)
      WHERE c.group_id=$1 AND c.id=$2 AND c.state='locked'`,
    [groupId,cycleId]);
  return r.rows[0]?.count??0;
}

export const emptySnapshotTotals=zero;
