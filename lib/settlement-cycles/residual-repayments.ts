import "server-only";
import {createHash,randomUUID} from "node:crypto";
import {pool} from "@/lib/db/pool";
import type {PoolClient} from "pg";
import {SettlementError} from "@/lib/settlements/service";
import {notifySettlement} from "@/lib/notifications/service";
import {activeGroup,cycle,enabled,pairActive} from "@/lib/settlement-cycles/proposals";
import {isolatedFinancialFixture,readEngineAccess,requireEngineAccess} from "@/lib/settlement-cycles/engine";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA=/^[0-9a-f]{64}$/;
const MAX_MINOR=9223372036854775807n;
const MAX_SOURCES=20000;
const err=(status:400|403|404|409,message:string)=>
  new SettlementError(status,message);

/** Legacy fixture access never replaces operator and group authorization
 * in deployed environments. Existing cash and noncash remain distinct. */
export function isResidualCashTestWritable():boolean{
  return isolatedFinancialFixture("BN006_TEST_ONLY");
}
type Application={
  id:string;groupId:string;cycleId:string;
  low:string;high:string;offset:string;snapshotFingerprint:string;
};
type Original={
  obligationId:string;debtorId:string;creditorId:string;
  originalMinor:string;expenseVersion:number;sourceVersion:number;
  invoiceVersion:number;completed:boolean;sourceOriginalMinor:string;
  confirmedCashMinor:string;confirmedSetoffMinor:string;
  pendingCashMinor:string;outstandingMinor:string;availableMinor:string;
  valid:boolean;
};
type CashAllocation={obligationId:string;amountMinor:string};
type CashStatus="ready"|"settled"|"blocked";
export type ResidualPreview={
  applicationId:string;cycleId:string;
  partyLow:string;partyHigh:string;offsetMinor:string;
  amountMinor:string;debtorId:string|null;creditorId:string|null;
  allocationCount:number;pendingCashMinor:string;
  remainingLowToHighMinor:string;remainingHighToLowMinor:string;
  fingerprint:string;status:CashStatus;blockedReason:string|null;
  financialEngineEnabled:boolean;
};
type Computed={preview:ResidualPreview;allocations:CashAllocation[]};
export type CreateResidualInput={
  expectedCycleVersion:number;requestKey:string;
  expectedFingerprint:string;note?:string;
};
type History={
  id:string;status:"pending"|"confirmed"|"rejected"|"cancelled";
  amountMinor:string;initiatedBy:string;createdAt:Date;resolvedAt:Date|null;
};
const applicationSql=`SELECT id,group_id AS "groupId",cycle_id AS "cycleId",
  party_low AS low,party_high AS high,offset_minor::text AS offset,
  snapshot_fingerprint AS "snapshotFingerprint"
  FROM group_settlement_bilateral_applications
  WHERE id=$1 AND group_id=$2 AND cycle_id=$3`;
const sourceSql=`SELECT o.id AS "obligationId",o.debtor_id AS "debtorId",
 o.creditor_id AS "creditorId",o.amount_minor::text AS "originalMinor",
 o.expense_version AS "expenseVersion",src.expense_version AS "sourceVersion",
 src.original_minor::text AS "sourceOriginalMinor",
 e.version AS "invoiceVersion",
 (e.completed_at IS NOT NULL AND e.completed_by=e.created_by) AS completed,
 b.confirmed_cash_minor::text AS "confirmedCashMinor",
 b.confirmed_setoff_minor::text AS "confirmedSetoffMinor",
 b.pending_cash_minor::text AS "pendingCashMinor",
 b.outstanding_minor::text AS "outstandingMinor",
 b.available_minor::text AS "availableMinor",
 (o.voided_at IS NULL AND e.deleted_at IS NULL AND
  o.expense_version=src.expense_version AND
  o.amount_minor=src.original_minor) AS valid
 FROM group_settlement_cycle_snapshot_obligations src
 JOIN obligations o ON o.id=src.obligation_id AND o.group_id=src.group_id
 JOIN expenses e ON e.id=o.expense_id AND e.group_id=src.group_id
 JOIN bn005_obligation_balances b ON b.obligation_id=o.id
 WHERE src.group_id=$1 AND src.cycle_id=$2
   AND ((src.debtor_id=$3 AND src.creditor_id=$4)
     OR (src.debtor_id=$4 AND src.creditor_id=$3))
 ORDER BY o.id`;

function ids(groupId:string,cycleId:string,applicationId:string){
  if(!UUID.test(groupId)||!UUID.test(cycleId)||!UUID.test(applicationId))
    throw err(400,"Mã nhóm, kỳ hoặc chứng từ bù trừ không hợp lệ.");
}
function validated(input:CreateResidualInput){
  if(!input||typeof input!=="object"||input.expectedCycleVersion!==3||
    !UUID.test(input.requestKey)||!SHA.test(input.expectedFingerprint)||
    typeof(input.note??"")!=="string"||(input.note??"").length>500)
    throw err(400,"Phiên bản, fingerprint, mã yêu cầu hoặc ghi chú không hợp lệ.");
  return (input.note??"").trim();
}
async function applied(client:PoolClient,groupId:string,cycleId:string,
  applicationId:string,actorId:string){
  const r=await client.query<Application>(applicationSql,
    [applicationId,groupId,cycleId]);
  const a=r.rows[0];
  if(!a)throw err(404,"Không tìm thấy chứng từ bù trừ đã áp dụng.");
  if(actorId!==a.low&&actorId!==a.high)
    throw err(403,"Chỉ hai người của chứng từ được quyết toán khoản chênh lệch.");
  return a;
}
async function history(client:PoolClient,applicationId:string){
  const r=await client.query<History>(`
    SELECT s.id,s.status,s.amount_minor::text AS "amountMinor",
      s.initiated_by AS "initiatedBy",s.created_at AS "createdAt",
      s.resolved_at AS "resolvedAt"
    FROM group_settlement_bilateral_residual_repayments r
    JOIN settlements s ON s.id=r.settlement_id
    WHERE r.application_id=$1 ORDER BY s.created_at DESC,s.id DESC
    LIMIT 100`,[applicationId]);
  return r.rows.map(x=>({...x,createdAt:x.createdAt.toISOString(),
    resolvedAt:x.resolvedAt?.toISOString()??null}));
}
async function originals(client:PoolClient,app:Application,lock:boolean){
  const r=await client.query<Original>(sourceSql+
    (lock?" FOR UPDATE OF o":""),[app.groupId,app.cycleId,app.low,app.high]);
  return r.rows;
}
function calculate(app:Application,rows:readonly Original[]):Computed{
  if(!rows.length||rows.length>MAX_SOURCES)throw err(409,
    "Danh sách nghĩa vụ gốc không hợp lệ hoặc vượt ngưỡng 20.000.");
  let lowToHigh=0n,highToLow=0n,pending=0n;
  const hash=createHash("sha256").update(JSON.stringify([
    "bn006-residual-v1",app.groupId,app.cycleId,app.id,
    app.snapshotFingerprint,app.low,app.high,app.offset,
  ])+"\n");
  for(const r of rows){
    const original=BigInt(r.originalMinor),cash=BigInt(r.confirmedCashMinor);
    const setoff=BigInt(r.confirmedSetoffMinor);
    const reserved=BigInt(r.pendingCashMinor);
    const outstanding=BigInt(r.outstandingMinor);
    const available=BigInt(r.availableMinor);
    if(!r.valid||r.invoiceVersion!==r.sourceVersion&&
        !(r.invoiceVersion===r.sourceVersion+1&&r.completed)||
       r.expenseVersion!==r.sourceVersion||
       r.originalMinor!==r.sourceOriginalMinor||
       original<=0n||cash<0n||setoff<0n||reserved<0n||
       original-cash-setoff!==outstanding||
       outstanding-reserved!==available||available<0n||
       !((r.debtorId===app.low&&r.creditorId===app.high)||
         (r.debtorId===app.high&&r.creditorId===app.low)))
      throw err(409,"Sổ nghĩa vụ nguồn không còn toàn vẹn.");
    if(r.debtorId===app.low)lowToHigh+=outstanding;
    else highToLow+=outstanding;
    pending+=reserved;
    hash.update(JSON.stringify([
      r.obligationId,r.debtorId,r.creditorId,r.originalMinor,
      r.sourceVersion,r.invoiceVersion,r.completed,
      r.confirmedCashMinor,r.confirmedSetoffMinor,
      r.pendingCashMinor,r.outstandingMinor,r.availableMinor,
    ])+"\n");
  }
  const total=lowToHigh+highToLow;
  const fingerprint=hash.update(JSON.stringify([
    lowToHigh.toString(),highToLow.toString(),pending.toString(),
  ])).digest("hex");
  const ambiguous=lowToHigh>0n&&highToLow>0n;
  const blocked=pending>0n||ambiguous;
  const status:CashStatus=total===0n?"settled":blocked?"blocked":"ready";
  const amount=status==="ready"?total:0n;
  const debtor=lowToHigh>0n?app.low:highToLow>0n?app.high:null;
  const creditor=debtor===app.low?app.high:debtor===app.high?app.low:null;
  const allocations:CashAllocation[]=status==="ready"?
    rows.filter(r=>r.debtorId===debtor&&BigInt(r.availableMinor)>0n)
      .map(r=>({obligationId:r.obligationId,amountMinor:r.availableMinor})):[];
  if(amount>MAX_MINOR||allocations.length>MAX_SOURCES)
    throw err(409,"Tổng tiền hoặc số phân bổ vượt giới hạn an toàn.");
  if(status==="ready"&&
    allocations.reduce((n,r)=>n+BigInt(r.amountMinor),0n)!==amount)
    throw err(409,"Số dư chênh lệch không khớp nguồn ban đầu.");
  return {preview:{
    applicationId:app.id,cycleId:app.cycleId,
    partyLow:app.low,partyHigh:app.high,offsetMinor:app.offset,
    amountMinor:amount.toString(),debtorId:status==="ready"?debtor:null,
    creditorId:status==="ready"?creditor:null,
    allocationCount:allocations.length,pendingCashMinor:pending.toString(),
    remainingLowToHighMinor:lowToHigh.toString(),
    remainingHighToLowMinor:highToLow.toString(),
    fingerprint,status,
    blockedReason:status!=="blocked"?null:pending>0n?
      "Đang có yêu cầu tiền mặt chờ xác nhận; cần xử lý trước.":
      "Còn nghĩa vụ hai chiều sau bù trừ; cần đối soát trước khi chuyển tiền.",
    financialEngineEnabled:false,
  },allocations};
}
async function transaction<T>(work:(client:PoolClient)=>Promise<T>):Promise<T>{
  const client=await pool.connect();
  try{await client.query("BEGIN");const value=await work(client);
    await client.query("COMMIT");return value;
  }catch(e){await client.query("ROLLBACK");throw e;}finally{client.release();}
}
export async function previewBilateralResidual(groupId:string,cycleId:string,
  applicationId:string,actorId:string){
  ids(groupId,cycleId,applicationId);
  const client=await pool.connect();
  try{
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await activeGroup(client,groupId,actorId,false);
    const app=await applied(client,groupId,cycleId,applicationId,actorId);
    await cycle(client,groupId,cycleId,false);
    const result=calculate(app,await originals(client,app,false));
    const attempts=await history(client,applicationId);
    const featureEnabled=await enabled(client,groupId);
    const access=await readEngineAccess(client,groupId);
    result.preview.financialEngineEnabled=access.bilateralEnabled;
    await client.query("COMMIT");
    return {preview:result.preview,history:attempts,
      financialEngineEnabled:access.bilateralEnabled,
      writable:access.bilateralEnabled||(isResidualCashTestWritable()&&featureEnabled)};
  }catch(e){await client.query("ROLLBACK");throw e;}
  finally{client.release();}
}

/** Residual money is never netted through a third party; one fully
 * auditable ordinary cash settlement is PENDING until its *other*
 * real counterparty confirms through the existing settlements route.
 */
export async function createBilateralResidual(groupId:string,cycleId:string,
  applicationId:string,actorId:string,input:CreateResidualInput){
  ids(groupId,cycleId,applicationId);
  const note=validated(input);
  const digest=createHash("sha256").update(JSON.stringify([
    "bn006-cash-request-v1",groupId,cycleId,applicationId,
    actorId,input.expectedCycleVersion,input.expectedFingerprint,note,
  ])).digest("hex");
  try{
    return await transaction(async client=>{
      // Same lock order as original cash + BN-004: group -> cycle -> originals.
      await activeGroup(client,groupId,actorId,true);
      const app=await applied(client,groupId,cycleId,applicationId,actorId);
      const previous=await client.query<{id:string;request_fingerprint:string}>(`
        SELECT id,request_fingerprint FROM settlements
        WHERE group_id=$1 AND initiated_by=$2 AND request_key=$3 FOR UPDATE`,
        [groupId,actorId,input.requestKey]);
      if(previous.rows[0]){
        if(previous.rows[0].request_fingerprint!==digest)
          throw err(409,"Mã yêu cầu đã được dùng cho giao dịch khác.");
        const link=await client.query(`
          SELECT 1 FROM group_settlement_bilateral_residual_repayments
          WHERE settlement_id=$1 AND application_id=$2
            AND group_id=$3 AND cycle_id=$4 AND request_digest=$5`,
          [previous.rows[0].id,applicationId,groupId,cycleId,digest]);
        if(!link.rowCount)throw err(409,"Yêu cầu cũ không thuộc chứng từ bù trừ.");
        return {id:previous.rows[0].id,alreadyCreated:true,cycleId,
          applicationId,financialEngineEnabled:(await readEngineAccess(client,groupId)).bilateralEnabled};
      }
      const access=await requireEngineAccess(client,groupId,"BN006_TEST_ONLY");
      if(!(await enabled(client,groupId)))
        throw err(409,"Nhóm chưa bật quyết toán và bù trừ hai chiều.");
      const c=await cycle(client,groupId,cycleId,true);
      if(c.snapshotFingerprint!==app.snapshotFingerprint)
        throw err(409,"Snapshot kỳ không khớp chứng từ đã áp dụng.");
      await pairActive(client,groupId,app.low,app.high);
      const {preview,allocations}=calculate(app,await originals(client,app,true));
      if(preview.fingerprint!==input.expectedFingerprint)
        throw err(409,"Công nợ đã thay đổi; hãy tải lại số dư chênh lệch.");
      if(preview.status!=="ready"||!preview.debtorId||!preview.creditorId)
        throw err(409,preview.blockedReason??"Không còn khoản chênh lệch để chuyển tiền.");
      const sid=randomUUID();
      await client.query(`INSERT INTO settlements
        (id,group_id,debtor_id,creditor_id,initiated_by,status,
          amount_minor,request_key,request_fingerprint,note)
        VALUES($1,$2,$3,$4,$5,'pending',$6,$7,$8,$9)`,
        [sid,groupId,preview.debtorId,preview.creditorId,actorId,
          preview.amountMinor,input.requestKey,digest,note]);
      const inserted=await client.query(`INSERT INTO settlement_allocations
        (settlement_id,obligation_id,group_id,debtor_id,creditor_id,amount_minor)
        SELECT $1,alloc.obligation_id,$2,$3,$4,alloc.amount_minor
        FROM unnest($5::uuid[],$6::bigint[]) AS
          alloc(obligation_id,amount_minor)`,
        [sid,groupId,preview.debtorId,preview.creditorId,
          allocations.map(a=>a.obligationId),allocations.map(a=>a.amountMinor)]);
      if(inserted.rowCount!==allocations.length)
        throw err(409,"Không thể ghi đầy đủ phân bổ chênh lệch; đã rollback.");
      await client.query(`INSERT INTO group_settlement_cycle_repayments
        (settlement_id,group_id,cycle_id,debtor_id,creditor_id,
         initiated_by,preview_fingerprint,allocation_count,amount_minor)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [sid,groupId,cycleId,preview.debtorId,preview.creditorId,
          actorId,preview.fingerprint,allocations.length,preview.amountMinor]);
      await client.query(`INSERT INTO group_settlement_bilateral_residual_repayments
        (settlement_id,application_id,group_id,cycle_id,debtor_id,
         creditor_id,initiated_by,preview_fingerprint,request_digest,
         amount_minor,allocation_count)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [sid,applicationId,groupId,cycleId,preview.debtorId,
          preview.creditorId,actorId,preview.fingerprint,digest,
          preview.amountMinor,allocations.length]);
      await client.query(`INSERT INTO settlement_events
        (id,settlement_id,actor_id,event_type,note)
        VALUES($1,$2,$3,'created',$4)`,[randomUUID(),sid,actorId,note]);
      await notifySettlement(client,sid,actorId,"settlement_requested");
      return {id:sid,alreadyCreated:false,applicationId,cycleId,
        amountMinor:preview.amountMinor,allocationCount:allocations.length,
        debtorId:preview.debtorId,creditorId:preview.creditorId,
        status:"pending" as const,cash:true,noncash:false,
        financialEngineEnabled:access.bilateralEnabled};
    });
  }catch(e){
    if(e instanceof SettlementError)throw e;
    if(e&&typeof e==="object"&&"code" in e&&
      ["23503","23505","23514","P0001","40001","40P01"].includes(String(e.code)))
      throw err(409,"Khoản chênh lệch đã thay đổi hoặc chứng từ không hợp lệ.");
    throw e;
  }
}
