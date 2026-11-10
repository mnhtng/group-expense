import "server-only";
import {createHash,randomUUID} from "node:crypto";
import {pool} from "@/lib/db/pool";
import type {PoolClient} from "pg";
import {SettlementError} from "@/lib/settlements/service";
import {activeGroup,pairActive,cycle,enabled,computed,transact}
  from "@/lib/settlement-cycles/proposals";

/** BN-004 ONLY: stores an append-only, exactly balanced NONCASH document.
 * Does NOT mutate original obligations, cash settlements, cycle state,
 * balances, invoices or UI (integration belongs to BN-005).
 * The global financial engine stays OFF; only the isolated PG17 CI
 * fixture is allowed to execute this experimental financial write.
 */
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA=/^[0-9a-f]{64}$/;
const fail=(status:400|403|404|409,message:string)=>
  new SettlementError(status,message);

export function isBilateralApplicationTestWritable():boolean{
  return process.env.CI==="true" &&
    process.env.BN004_TEST_ONLY==="isolated-pg17" &&
    process.env.DATABASE_URL==="postgresql://test:test@localhost:5432/group_expense";
}
export type ApplyBilateralInput={
  expectedVersion:number;expectedFingerprint:string;requestKey:string;
};
type Proposal={
  id:string;groupId:string;cycleId:string;partyLow:string;partyHigh:string;
  version:number;amount:string;fingerprint:string;snapshotFingerprint:string;
  headId:string|null;headVersion:number;createdAt:Date;
};
type Stored={
  id:string;proposalId:string;groupId:string;cycleId:string;
  partyLow:string;partyHigh:string;appliedBy:string;
  amount:string;requestDigest:string;fingerprint:string;version:number;
  createdAt:Date;
};
export type AppliedNoncashDocument={
  id:string;proposalId:string;groupId:string;cycleId:string;
  partyLow:string;partyHigh:string;appliedBy:string;
  offsetMinor:string;proposalVersion:number;sourceFingerprint:string;
  appliedAt:string;noncash:true;cashTransferredMinor:"0";
};
const proposalQuery=`SELECT p.id,p.group_id AS "groupId",p.cycle_id AS "cycleId",
    p.party_low AS "partyLow",p.party_high AS "partyHigh",
    p.version,p.offset_minor::text AS amount,
    p.source_fingerprint AS fingerprint,
    p.snapshot_fingerprint AS "snapshotFingerprint",
    p.created_at AS "createdAt",
    h.current_proposal_id AS "headId",h.version AS "headVersion"
  FROM group_settlement_bilateral_proposals p
  JOIN group_settlement_bilateral_heads h
    ON h.group_id=p.group_id AND h.cycle_id=p.cycle_id
      AND h.party_low=p.party_low AND h.party_high=p.party_high
  WHERE p.id=$1 AND p.group_id=$2 AND p.cycle_id=$3`;
const applicationColumns=`id,proposal_id AS "proposalId",
  group_id AS "groupId",cycle_id AS "cycleId",
  party_low AS "partyLow",party_high AS "partyHigh",
  applied_by AS "appliedBy",offset_minor::text AS amount,
  request_digest AS "requestDigest",source_fingerprint AS fingerprint,
  proposal_version AS version,created_at AS "createdAt"`;
const toDocument=(x:Stored):AppliedNoncashDocument=>({
  id:x.id,proposalId:x.proposalId,groupId:x.groupId,cycleId:x.cycleId,
  partyLow:x.partyLow,partyHigh:x.partyHigh,appliedBy:x.appliedBy,
  offsetMinor:x.amount,proposalVersion:x.version,
  sourceFingerprint:x.fingerprint,appliedAt:x.createdAt.toISOString(),
  noncash:true,cashTransferredMinor:"0",
});
async function selected(client:PoolClient,groupId:string,cycleId:string,id:string,
  lock=false){
  const r=await client.query<Proposal>(
    proposalQuery+(lock?" FOR UPDATE OF p,h":""),[id,groupId,cycleId]);
  if(!r.rows[0])throw fail(404,"Không tìm thấy đề xuất bù trừ.");
  return r.rows[0];
}
function ids(groupId:string,cycleId:string,id:string){
  if(!UUID.test(groupId)||!UUID.test(cycleId)||!UUID.test(id))
    throw fail(400,"Mã nhóm, kỳ hoặc đề xuất không hợp lệ.");
}
async function prior(client:PoolClient,groupId:string,actorId:string,key:string){
  const r=await client.query<Stored>(
    `SELECT ${applicationColumns} FROM group_settlement_bilateral_applications
     WHERE group_id=$1 AND applied_by=$2 AND request_key=$3 FOR UPDATE`,
    [groupId,actorId,key]);
  return r.rows[0]??null;
}
/** The read is not a source of permission to apply. All eligibility is
 * re-evaluated under locks during POST.
 */
export async function getBilateralApplication(groupId:string,cycleId:string,
  proposalId:string,actorId:string){
  ids(groupId,cycleId,proposalId);
  const client=await pool.connect();
  try{
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await activeGroup(client,groupId,actorId,false);
    const p=await selected(client,groupId,cycleId,proposalId);
    if(actorId!==p.partyLow&&actorId!==p.partyHigh)
      throw fail(403,"Chỉ hai bên được xem chứng từ bù trừ.");
    const r=await client.query<Stored>(
      `SELECT ${applicationColumns} FROM group_settlement_bilateral_applications
       WHERE proposal_id=$1`,[proposalId]);
    await client.query("COMMIT");
    return {application:r.rows[0]?toDocument(r.rows[0]):null,
      financialEngineEnabled:false};
  }catch(e){await client.query("ROLLBACK");throw e;}
  finally{client.release();}
}
/** One approved proposal -> ONE atomic application in the disposable CI DB.
 * Pair and source hashes are compared to live money before any insert.
 */
export async function applyBilateralNoncash(groupId:string,cycleId:string,
  proposalId:string,actorId:string,input:ApplyBilateralInput){
  ids(groupId,cycleId,proposalId);
  if(!input||!Number.isSafeInteger(input.expectedVersion)||
    input.expectedVersion<1||!SHA.test(input.expectedFingerprint)||
    !UUID.test(input.requestKey))throw fail(400,
      "Phiên bản, fingerprint hoặc mã yêu cầu không hợp lệ.");
  if(!isBilateralApplicationTestWritable())
    throw fail(409,"Bút toán bù trừ chưa được mở trong môi trường này.");
  const digest=createHash("sha256").update(JSON.stringify([
    "bn004-noncash-v1",groupId,cycleId,proposalId,actorId,
    input.expectedVersion,input.expectedFingerprint,
  ])).digest("hex");

  try{
    return await transact(async client=>{
      // Exactly the original lock order: GROUP -> CYCLE -> HEAD/PROPOSAL
      // -> immutable original obligations. The group lock serializes
      // settlement cash confirmations and source reservation changes.
      await activeGroup(client,groupId,actorId,true);
      const p=await selected(client,groupId,cycleId,proposalId);
      if(actorId!==p.partyLow&&actorId!==p.partyHigh)
        throw fail(403,"Chỉ hai người trong đề xuất được ghi bù trừ.");
      if(input.expectedVersion!==p.version||
        input.expectedFingerprint!==p.fingerprint)
        throw fail(409,"Đề xuất không khớp phiên bản hoặc fingerprint.");

      // Idempotent retry reads the original immutable application, not
      // the recalculated balance, even after the group has opted out.
      const previous=await prior(client,groupId,actorId,input.requestKey);
      if(previous){
        if(previous.proposalId!==proposalId||previous.requestDigest!==digest)
          throw fail(409,"Mã yêu cầu đã dùng cho bút toán khác.");
        return {application:toDocument(previous),alreadyApplied:true};
      }
      if(!(await enabled(client,groupId)))
        throw fail(409,"Nhóm chưa bật quyết toán và bù trừ hai chiều.");
      await pairActive(client,groupId,p.partyLow,p.partyHigh);
      const c=await cycle(client,groupId,cycleId,true);
      const locked=await selected(client,groupId,cycleId,proposalId,true);
      if(locked.headId!==p.id||locked.headVersion!==p.version)
        throw fail(409,"Đề xuất đã bị thay thế.");
      if(c.snapshotFingerprint!==p.snapshotFingerprint)
        throw fail(409,"Snapshot kỳ quyết toán không còn khớp.");
      const historical=await client.query(
        `SELECT 1 FROM group_settlement_bilateral_applications
         WHERE group_id=$1 AND cycle_id=$2 AND party_low=$3 AND party_high=$4`,
        [groupId,cycleId,p.partyLow,p.partyHigh]);
      if(historical.rowCount)throw fail(409,
        "Cặp thành viên đã có bút toán phi tiền mặt cho kỳ này.");

      const approval=await client.query<{
        approvals:number;terminal:boolean;now:Date;
      }>(`SELECT
          (SELECT count(DISTINCT actor_id)::int
             FROM group_settlement_bilateral_decision_events
             WHERE proposal_id=$1 AND event_type='approve'
               AND actor_id IN($2,$3)) AS approvals,
          EXISTS(SELECT 1 FROM group_settlement_bilateral_decision_events
             WHERE proposal_id=$1 AND event_type IN
               ('reject','revoke','invalidated','expired')) AS terminal,
          clock_timestamp() AS now`,[proposalId,p.partyLow,p.partyHigh]);
      const decisions=approval.rows[0];
      if(decisions.approvals!==2||decisions.terminal||
        decisions.now.getTime()>=p.createdAt.getTime()+72*3600*1000)
        throw fail(409,"Bù trừ cần hai xác nhận còn hiệu lực.");
      const live=await computed(client,groupId,cycleId,c,
        p.partyLow,p.partyHigh,true);
      if(live.fingerprint!==p.fingerprint||
         live.calculation.offsetMinor!==p.amount||
         !live.calculation.hasOffset)
        throw fail(409,"Số dư đã thay đổi; cần lập đề xuất mới.");

      const sources=await client.query<{obligation_id:string;proposed_minor:string}>(
        `SELECT obligation_id,proposed_minor::text
         FROM group_settlement_bilateral_sources
         WHERE proposal_id=$1 AND proposed_minor>0 ORDER BY obligation_id`,
        [proposalId]);
      const byId=new Map(live.sources.map(x=>[x.obligationId,x.proposedMinor]));
      if(sources.rowCount!==live.sources.filter(x=>BigInt(x.proposedMinor)>0n).length ||
        sources.rows.some(s=>byId.get(s.obligation_id)!==s.proposed_minor))
        throw fail(409,"Phân bổ nguồn không khớp đề xuất được duyệt.");

      const id=randomUUID();
      await client.query(`INSERT INTO group_settlement_bilateral_applications
        (id,proposal_id,group_id,cycle_id,party_low,party_high,applied_by,
         request_key,request_digest,source_fingerprint,snapshot_fingerprint,
         proposal_version,offset_minor)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [id,proposalId,groupId,cycleId,p.partyLow,p.partyHigh,actorId,
          input.requestKey,digest,p.fingerprint,p.snapshotFingerprint,
          p.version,p.amount]);
      const inserted=await client.query(`
        INSERT INTO group_settlement_bilateral_application_allocations
          (application_id,proposal_id,group_id,cycle_id,obligation_id,
           debtor_id,creditor_id,amount_minor)
        SELECT $1,s.proposal_id,s.group_id,s.cycle_id,s.obligation_id,
               s.debtor_id,s.creditor_id,s.proposed_minor
        FROM group_settlement_bilateral_sources s
        WHERE s.proposal_id=$2 AND s.proposed_minor>0`,[id,proposalId]);
      if(inserted.rowCount!==sources.rows.length)
        throw fail(409,"Không đủ chứng từ bù trừ; đã rollback toàn bộ.");
      // Force deferred check *before* returning success; all changes
      // still rollback together if conservation fails.
      await client.query("SET CONSTRAINTS bn004_conservation_on_commit IMMEDIATE");
      const saved=await client.query<Stored>(
        `SELECT ${applicationColumns} FROM group_settlement_bilateral_applications
         WHERE id=$1`,[id]);
      if(!saved.rows[0])throw fail(409,"Không đọc lại được bút toán bù trừ.");
      return {application:toDocument(saved.rows[0]),alreadyApplied:false};
    });
  }catch(e){
    if(e instanceof SettlementError)throw e;
    if(e&&typeof e==="object"&&"code" in e&&
      ["23505","23503","23514","P0001","40001","40P01"].includes(String(e.code)))
      throw fail(409,"Bù trừ trùng, không hợp lệ hoặc công nợ đã thay đổi.");
    throw e;
  }
}
