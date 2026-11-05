import "server-only";
import {createHash,randomUUID} from "node:crypto";
import type {PoolClient} from "pg";
import {pool} from "@/lib/db/pool";
import {
  calculateBilateralSetoff,BilateralCalculationError,
  type BilateralEligibleObligation,type BilateralCalculation,
} from "@/lib/settlement-cycles/bilateral-calculator";
import {SettlementError} from "@/lib/settlements/service";

/** BN-002 is proposal METADATA ONLY, not pending_setoff reservations.
 * There is NO approval state, notification, money ledger or application here.
 * All reads use canonical complete SQL (never paginated debt API data).
 */
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA=/^[0-9a-f]{64}$/;
const MAX_SOURCES=20000;
const err=(status:400|403|404|409,message:string)=>new SettlementError(status,message);
type Cycle={id:string;version:number;state:string;startDate:string;endDate:string;snapshotFingerprint:string};
type Row={
  obligationId:string; debtorId:string;creditorId:string;
  occurredOn:string; sourceVersion:number;currentVersion:number;
  originalMinor:string;confirmedCashMinor:string;pendingCashMinor:string;
  confirmedSetoffMinor:string;
  sourceOriginalMinor:string;sourceExpenseVersion:number;
  voided:boolean;deleted:boolean;
};
type ProposalRow={
  id:string;version:number;partyLow:string;partyHigh:string;
  createdBy:string;offsetMinor:string;sourceFingerprint:string;
  snapshotFingerprint:string;sourceCount:number;allocationCount:number;
  createdAt:Date;
};
export type ProposalSummary={
  id:string;version:number;partyLow:string;partyHigh:string;
  createdBy:string;offsetMinor:string;sourceFingerprint:string;
  snapshotFingerprint:string;sourceCount:number;allocationCount:number;
  createdAt:string;
};
export type BilateralProposalPreview={
  fingerprint:string;
  snapshotFingerprint:string;
  calculation:BilateralCalculation;
  eligibleSourceCount:number;
  writable:boolean;
  currentVersion:number;
  current:ProposalSummary|null;
  staleCurrent:boolean;
};
export type BilateralProposalInput={
  partyAId:string;partyBId:string;expectedVersion:number;
  expectedFingerprint:string;requestKey:string;
};
const selectCycle=`SELECT c.id,c.version,c.state,
  c.period_start::text AS "startDate",c.period_end::text AS "endDate",
  s.fingerprint AS "snapshotFingerprint"
  FROM group_settlement_cycles c
  JOIN group_settlement_cycle_snapshots s ON s.cycle_id=c.id AND s.group_id=c.group_id
  WHERE c.group_id=$1 AND c.id=$2`;
const selectSources=`SELECT src.obligation_id AS "obligationId",
    src.debtor_id AS "debtorId",src.creditor_id AS "creditorId",
    se.occurred_on::text AS "occurredOn",
    src.expense_version AS "sourceVersion",
    -- Creator-only completion increments e.version without changing any
    -- immutable original obligation or item shares. That *metadata-only*
    -- increment must not invalidate other unpaid sources in the same pair.
    CASE WHEN e.version=src.expense_version+1
      AND e.completed_at IS NOT NULL AND e.completed_by=e.created_by
      THEN src.expense_version ELSE e.version END AS "currentVersion",
    o.amount_minor::text AS "originalMinor",
    src.original_minor::text AS "sourceOriginalMinor",
    src.expense_version AS "sourceExpenseVersion",
    bal.confirmed_cash_minor::text AS "confirmedCashMinor",
    bal.pending_cash_minor::text AS "pendingCashMinor",
    bal.confirmed_setoff_minor::text AS "confirmedSetoffMinor",
    (o.voided_at IS NOT NULL) AS "voided",
    (e.deleted_at IS NOT NULL) AS "deleted"
  FROM group_settlement_cycle_snapshot_obligations src
  JOIN obligations o ON o.id=src.obligation_id AND o.group_id=src.group_id
  JOIN expenses e ON e.id=o.expense_id AND e.group_id=src.group_id
  JOIN group_settlement_cycle_snapshot_expenses se
    ON se.cycle_id=src.cycle_id AND se.group_id=src.group_id
       AND se.expense_id=o.expense_id
  JOIN bn005_obligation_balances bal ON bal.obligation_id=o.id
  WHERE src.cycle_id=$1 AND src.group_id=$2
    AND ((src.debtor_id=$3 AND src.creditor_id=$4)
      OR (src.debtor_id=$4 AND src.creditor_id=$3))
  ORDER BY o.id`;

function scoped(groupId:string,cycleId:string,a:string,b:string){
  if(!UUID.test(groupId)||!UUID.test(cycleId)||
     typeof a!=="string"||typeof b!=="string"||
     !a.length||!b.length||a.length>256||b.length>256||
     a.trim()!==a||b.trim()!==b||a===b)
    throw err(400,"Nhóm, kỳ hoặc cặp thành viên không hợp lệ.");
  return a<b?[a,b] as const:[b,a] as const;
}
function summary(row:ProposalRow):ProposalSummary{
  return {...row,createdAt:row.createdAt.toISOString()};
}
export async function activeGroup(client:PoolClient,groupId:string,actorId:string,write:boolean){
  const g=await client.query(
    `SELECT 1 FROM groups WHERE id=$1 AND archived_at IS NULL ${write?"FOR UPDATE":""}`,[groupId]);
  if(!g.rowCount)throw err(404,"Không tìm thấy nhóm.");
  const member=await client.query(
    "SELECT 1 FROM group_members WHERE group_id=$1 AND user_id=$2 AND status='active'",
    [groupId,actorId]);
  if(!member.rowCount)throw err(404,"Bạn không phải thành viên đang hoạt động.");
}
export async function pairActive(client:PoolClient,groupId:string,a:string,b:string){
  const m=await client.query(
    `SELECT user_id FROM group_members
      WHERE group_id=$1 AND status='active' AND user_id=ANY($2::text[])`,
    [groupId,[a,b]]);
  if(m.rowCount!==2)throw err(409,
    "Cả hai người trong đề xuất phải đang là thành viên nhóm.");
}
export async function cycle(client:PoolClient,groupId:string,cycleId:string,write:boolean){
  const result=await client.query<Cycle>(selectCycle+
    (write?" FOR UPDATE OF c":""),[groupId,cycleId]);
  const c=result.rows[0];
  if(!c)throw err(404,"Không tìm thấy kỳ đã khóa.");
  if(c.state!=="locked"||c.version!==3)
    throw err(409,"Chỉ có thể lập đề xuất cho kỳ đã khóa snapshot.");
  return c;
}
export async function enabled(client:PoolClient,groupId:string){
  const s=await client.query<{requested_enabled:boolean;requested_bilateral_netting:boolean}>(
    `SELECT requested_enabled,requested_bilateral_netting
      FROM group_settlement_settings WHERE group_id=$1`,[groupId]);
  return s.rows[0]?.requested_enabled===true&&s.rows[0]?.requested_bilateral_netting===true;
}
async function currentProposal(client:PoolClient,groupId:string,cycleId:string,
  low:string,high:string){
  const r=await client.query<ProposalRow>(
    `SELECT p.id,p.version,p.party_low AS "partyLow",p.party_high AS "partyHigh",
      p.created_by AS "createdBy",p.offset_minor::text AS "offsetMinor",
      p.source_fingerprint AS "sourceFingerprint",
      p.snapshot_fingerprint AS "snapshotFingerprint",
      p.source_count AS "sourceCount",p.allocation_count AS "allocationCount",
      p.created_at AS "createdAt"
      FROM group_settlement_bilateral_heads h
      JOIN group_settlement_bilateral_proposals p ON p.id=h.current_proposal_id
      WHERE h.group_id=$1 AND h.cycle_id=$2
        AND h.party_low=$3 AND h.party_high=$4`,
    [groupId,cycleId,low,high]);
  return r.rows[0]??null;
}
async function state(client:PoolClient,groupId:string,cycleId:string,
  low:string,high:string,lock:boolean){
  const r=await client.query<{version:number}>(
    `SELECT version FROM group_settlement_bilateral_heads
      WHERE group_id=$1 AND cycle_id=$2 AND party_low=$3 AND party_high=$4
      ${lock?"FOR UPDATE":""}`,
    [groupId,cycleId,low,high]);
  return r.rows[0]?.version??0;
}
function validRows(rows:readonly Row[],groupId:string,cycleId:string):BilateralEligibleObligation[]{
  if(rows.length>MAX_SOURCES)throw err(409,"Số lượng nguồn vượt giới hạn 20.000 nghĩa vụ.");
  return rows.map(r=>{
    if(r.sourceOriginalMinor!==r.originalMinor||
       r.sourceExpenseVersion!==r.sourceVersion)
      throw err(409,"Dữ liệu snapshot và nghĩa vụ gốc đã thay đổi.");
    return {
      groupId,cycleId,currency:"VND" as const,
      obligationId:r.obligationId,debtorId:r.debtorId,creditorId:r.creditorId,
      occurredOn:r.occurredOn,snapshotExpenseVersion:r.sourceVersion,
      currentExpenseVersion:r.currentVersion,inLockedCycleSnapshot:true,
      obligationVoided:r.voided,expenseDeleted:r.deleted,
      originalMinor:r.originalMinor,
      confirmedCashMinor:r.confirmedCashMinor,pendingCashMinor:r.pendingCashMinor,
      confirmedSetoffMinor:r.confirmedSetoffMinor,pendingSetoffMinor:"0",
    };
  });
}
export async function computed(client:PoolClient,groupId:string,cycleId:string,c:Cycle,
  low:string,high:string,lock:boolean){
  // All source rows, including completely paid ones, bind the fingerprint.
  const r=await client.query<Row>(selectSources+
    (lock?" FOR UPDATE OF o":""),[cycleId,groupId,low,high]);
  const eligible=validRows(r.rows,groupId,cycleId);
  let calculation:BilateralCalculation;
  try{
    calculation=calculateBilateralSetoff({
      groupId,cycleId,cycleState:"locked",periodStart:c.startDate,
      periodEnd:c.endDate,currency:"VND",partyAId:low,partyBId:high,
      obligations:eligible,
    });
  }catch(cause){
    if(cause instanceof BilateralCalculationError)
      throw err(409,"Nghĩa vụ hoặc trạng thái thanh toán không còn hợp lệ.");
    throw cause;
  }
  const allocation=new Map<string,string>();
  for(const item of [...calculation.aOwesB.allocations,
                      ...calculation.bOwesA.allocations]){
    allocation.set(item.obligationId,item.setoffMinor);
  }
  const hash=createHash("sha256").update(JSON.stringify([
    "bn002-live-v1",groupId,cycleId,c.snapshotFingerprint,low,high,
    c.startDate,c.endDate,
  ])+"\n");
  const ordered=[...eligible].sort((a,b)=>
    a.occurredOn<b.occurredOn?-1:a.occurredOn>b.occurredOn?1:
      a.obligationId<b.obligationId?-1:a.obligationId>b.obligationId?1:0);
  const sources=ordered.map(r=>{
    const pending=BigInt(r.pendingCashMinor);
    const cash=BigInt(r.confirmedCashMinor);
    const amount=BigInt(r.originalMinor);
    const setoff=BigInt(r.confirmedSetoffMinor);
    const before=amount-cash-setoff-pending;
    const proposed=BigInt(allocation.get(r.obligationId)??"0");
    const out={
      obligationId:r.obligationId,debtorId:r.debtorId,creditorId:r.creditorId,
      occurredOn:r.occurredOn,expenseVersion:r.currentExpenseVersion,
      originalMinor:r.originalMinor,confirmedCashMinor:r.confirmedCashMinor,
      pendingCashMinor:r.pendingCashMinor,confirmedSetoffMinor:r.confirmedSetoffMinor,
      pendingSetoffMinor:"0",availableBeforeMinor:before.toString(),
      proposedMinor:proposed.toString(),
      availableAfterMinor:(before-proposed).toString(),
    };
    hash.update(JSON.stringify(Object.values(out))+"\n");
    return out;
  });
  const fingerprint=hash.update(JSON.stringify([
    calculation.offsetMinor,calculation.aOwesB.availableBeforeMinor,
    calculation.bOwesA.availableBeforeMinor,
  ])).digest("hex");
  return {calculation,fingerprint,sources};
}
export async function transact<T>(work:(client:PoolClient)=>Promise<T>):Promise<T>{
  const client=await pool.connect();
  try{await client.query("BEGIN");const value=await work(client);
    await client.query("COMMIT");return value;
  }catch(e){await client.query("ROLLBACK");throw e;}
  finally{client.release();}
}

/** Read-only preview/immutable latest document visible only to the pair. */
export async function previewBilateralProposal(groupId:string,cycleId:string,
  actorId:string,partyAId:string,partyBId:string):Promise<BilateralProposalPreview>{
  const [low,high]=scoped(groupId,cycleId,partyAId,partyBId);
  if(actorId!==low&&actorId!==high)throw err(403,"Chỉ hai bên được xem đề xuất.");
  const client=await pool.connect();
  try{
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await activeGroup(client,groupId,actorId,false);
    await pairActive(client,groupId,low,high);
    const c=await cycle(client,groupId,cycleId,false);
    const writable=await enabled(client,groupId);
    const version=await state(client,groupId,cycleId,low,high,false);
    const current=await currentProposal(client,groupId,cycleId,low,high);
    const live=await computed(client,groupId,cycleId,c,low,high,false);
    await client.query("COMMIT");
    return {fingerprint:live.fingerprint,snapshotFingerprint:c.snapshotFingerprint,
      calculation:live.calculation,eligibleSourceCount:live.sources.length,
      writable,currentVersion:version,
      current:current?summary(current):null,
      staleCurrent:current!==null&&current.sourceFingerprint!==live.fingerprint};
  }catch(e){await client.query("ROLLBACK");throw e;}
  finally{client.release();}
}

/**
 * One group lock serializes manual cash and proposal writes. Head versions
 * serialize two simultaneous participants. No APPROVAL or reservation occurs.
 */
export async function createBilateralProposal(groupId:string,cycleId:string,
  actorId:string,input:BilateralProposalInput){
  const [low,high]=scoped(groupId,cycleId,input?.partyAId,input?.partyBId);
  if(!input||!Number.isSafeInteger(input.expectedVersion)||
     input.expectedVersion<0||!UUID.test(input.requestKey)||
     !SHA.test(input.expectedFingerprint))
    throw err(400,"Phiên bản, fingerprint hoặc mã yêu cầu không hợp lệ.");
  if(actorId!==low&&actorId!==high)throw err(403,"Chỉ hai bên được lập đề xuất.");
  const requestDigest=createHash("sha256").update(JSON.stringify([
    "bn002-request-v1",groupId,cycleId,low,high,input.expectedVersion,
    input.expectedFingerprint,
  ])).digest("hex");
  return transact(async client=>{
    await activeGroup(client,groupId,actorId,true);
    const prior=await client.query<ProposalRow & {requestDigest:string}>(
      `SELECT id,version,request_digest AS "requestDigest",
        party_low AS "partyLow",party_high AS "partyHigh",
        created_by AS "createdBy",offset_minor::text AS "offsetMinor",
        source_fingerprint AS "sourceFingerprint",
        snapshot_fingerprint AS "snapshotFingerprint",
        source_count AS "sourceCount",allocation_count AS "allocationCount",
        created_at AS "createdAt"
       FROM group_settlement_bilateral_proposals
       WHERE group_id=$1 AND created_by=$2 AND request_key=$3 FOR UPDATE`,
      [groupId,actorId,input.requestKey]);
    if(prior.rows[0]){
      const p=prior.rows[0];
      if(p.requestDigest!==requestDigest||p.partyLow!==low||p.partyHigh!==high||
         p.sourceFingerprint!==input.expectedFingerprint)
        throw err(409,"Mã yêu cầu đã được dùng cho đề xuất khác.");
      return {proposal:summary(p),alreadyCreated:true};
    }
    if(!(await enabled(client,groupId)))throw err(409,
      "Nhóm chưa bật chuẩn bị quyết toán và bù trừ hai chiều.");
    await pairActive(client,groupId,low,high);
    const c=await cycle(client,groupId,cycleId,true);
    await client.query(
      `INSERT INTO group_settlement_bilateral_heads
       (group_id,cycle_id,party_low,party_high)
       VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
      [groupId,cycleId,low,high]);
    const version=await state(client,groupId,cycleId,low,high,true);
    if(version!==input.expectedVersion)throw err(409,
      "Đề xuất đã có phiên bản mới. Hãy xem lại trước khi lập đề xuất.");
    const current=await currentProposal(client,groupId,cycleId,low,high);
    const live=await computed(client,groupId,cycleId,c,low,high,true);
    if(live.fingerprint!==input.expectedFingerprint)
      throw err(409,"Số dư công nợ đã thay đổi. Phải tính lại đề xuất.");
    // BN-004 permits exactly one completed noncash document per pair/cycle.
    // Reject a second proposal explicitly rather than publishing historical
    // BN-002 source rows whose AS-OF noncash values must remain immutable.
    const applied=await client.query(
      `SELECT 1 FROM group_settlement_bilateral_applications
       WHERE group_id=$1 AND cycle_id=$2 AND party_low=$3 AND party_high=$4`,
      [groupId,cycleId,low,high]);
    if(applied.rowCount)throw err(409,
      "Cặp thành viên đã bù trừ kỳ này; không được lập lại trên cùng nghĩa vụ.");
    if(current?.sourceFingerprint===live.fingerprint){
      // BN-003 terminal decisions close ONE immutable version. A fresh
      // proposal is allowed after reject/revoke/invalidate/72h expiry;
      // none of the previous signatories' decisions may be inherited.
      const decisions=await client.query(
        `SELECT 1 FROM group_settlement_bilateral_decision_events
         WHERE proposal_id=$1 AND event_type IN
           ('reject','revoke','invalidated','expired') LIMIT 1`,
        [current.id]);
      const details=await client.query<{created_at:Date}>(
        "SELECT created_at FROM group_settlement_bilateral_proposals WHERE id=$1",
        [current.id]);
      const dbNow=await client.query<{now:Date}>("SELECT clock_timestamp() AS now");
      const expired=details.rows[0]?
        dbNow.rows[0].now.getTime()>=
          details.rows[0].created_at.getTime()+72*60*60*1000:false;
      if(!decisions.rowCount&&!expired)
        throw err(409,"Đề xuất cho số liệu này đã tồn tại.");
    }
    if(!live.calculation.hasOffset||BigInt(live.calculation.offsetMinor)<=0n)
      throw err(409,"Hai người không có công nợ khả dụng để bù trừ.");
    const id=randomUUID(),next=version+1;
    const allocations=live.sources.filter(s=>BigInt(s.proposedMinor)>0n).length;
    await client.query(
      `INSERT INTO group_settlement_bilateral_proposals
       (id,group_id,cycle_id,party_low,party_high,version,
        request_key,request_digest,source_fingerprint,snapshot_fingerprint,
        created_by,offset_minor,source_count,allocation_count)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [id,groupId,cycleId,low,high,next,input.requestKey,
        requestDigest,live.fingerprint,c.snapshotFingerprint,
        actorId,live.calculation.offsetMinor,live.sources.length,allocations]);
    const inserted=await client.query(
      `INSERT INTO group_settlement_bilateral_sources
       (proposal_id,group_id,cycle_id,party_low,party_high,
        obligation_id,debtor_id,creditor_id,occurred_on,expense_version,
        original_minor,confirmed_cash_minor,pending_cash_minor,
        confirmed_setoff_minor,pending_setoff_minor,
        available_before_minor,proposed_minor,available_after_minor)
       SELECT $1,$2,$3,$4,$5,
        src."obligationId",src."debtorId",src."creditorId",src."occurredOn",
        src."expenseVersion",src."originalMinor",src."confirmedCashMinor",
        src."pendingCashMinor",src."confirmedSetoffMinor",src."pendingSetoffMinor",
        src."availableBeforeMinor",src."proposedMinor",src."availableAfterMinor"
       FROM jsonb_to_recordset($6::jsonb) AS src(
        "obligationId" uuid,"debtorId" text,"creditorId" text,
        "occurredOn" date,"expenseVersion" integer,
        "originalMinor" bigint,"confirmedCashMinor" numeric,
        "pendingCashMinor" numeric,"confirmedSetoffMinor" numeric,
        "pendingSetoffMinor" numeric,"availableBeforeMinor" numeric,
        "proposedMinor" numeric,"availableAfterMinor" numeric)`,
      [id,groupId,cycleId,low,high,JSON.stringify(live.sources)]);
    if(inserted.rowCount!==live.sources.length)
      throw err(409,"Bằng chứng nghĩa vụ không đầy đủ; toàn bộ giao dịch đã rollback.");
    await client.query(
      `UPDATE group_settlement_bilateral_heads
       SET version=$5,current_proposal_id=$6,updated_at=clock_timestamp()
       WHERE group_id=$1 AND cycle_id=$2 AND party_low=$3 AND party_high=$4`,
      [groupId,cycleId,low,high,next,id]);
    const result=await currentProposal(client,groupId,cycleId,low,high);
    if(!result||result.id!==id)throw err(409,"Không thể đối soát phiên bản đề xuất.");
    return {proposal:summary(result),alreadyCreated:false};
  });
}
