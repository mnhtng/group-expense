import "server-only";
import {createHash,randomUUID} from "node:crypto";
import {pool} from "@/lib/db/pool";
import type {PoolClient} from "pg";
import {SettlementError} from "@/lib/settlements/service";
import {
  activeGroup,pairActive,cycle,enabled,computed,transact,
} from "@/lib/settlement-cycles/proposals";

/** BN-003: decisions are signed by the authenticated account, never a
 * client-supplied actor. Two distinct approvals prepare a proposal ONLY;
 * nothing in this module modifies obligations, payments, reservations,
 * invoice completion or noncash ledger.
 */
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA=/^[0-9a-f]{64}$/;
const EXPIRES_MS=72*60*60*1000;
const error=(status:400|403|404|409,message:string)=>new SettlementError(status,message);
export type DecisionAction="approve"|"reject"|"revoke";
export type DecisionStatus="pending"|"partially_approved"|"agreed"|
  "rejected"|"revoked"|"invalidated"|"expired"|"superseded";
type Proposal={
  id:string;groupId:string;cycleId:string;partyLow:string;partyHigh:string;
  version:number;sourceFingerprint:string;snapshotFingerprint:string;
  createdAt:Date;headId:string|null;
};
type EventRow={
  id:string;eventType:string;actorId:string|null;requestKey:string;
  requestDigest:string;sourceFingerprint:string;recordedAt:Date;
};
export type DecisionView={
  proposalId:string;version:number;sourceFingerprint:string;
  status:DecisionStatus;isCurrent:boolean;expiresAt:string;
  approvedBy:string[];approvalCount:number;readyForApplication:false;
  financialEngineEnabled:false;canApprove:boolean;canReject:boolean;
  canRevoke:boolean;liveMatches:boolean;events:{
    id:string;eventType:string;actorId:string|null;recordedAt:string;
  }[];
};
export type DecisionRequest={
  action:DecisionAction;expectedVersion:number;
  expectedFingerprint:string;requestKey:string;
};
function validateIds(groupId:string,cycleId:string,proposalId:string){
  if(!UUID.test(groupId)||!UUID.test(cycleId)||!UUID.test(proposalId))
    throw error(400,"Mã nhóm, kỳ hoặc đề xuất không hợp lệ.");
}
async function selectProposal(client:PoolClient,groupId:string,cycleId:string,
  proposalId:string,lock:boolean):Promise<Proposal>{
  const r=await client.query<Proposal>(`
    SELECT p.id,p.group_id AS "groupId",p.cycle_id AS "cycleId",
      p.party_low AS "partyLow",p.party_high AS "partyHigh",
      p.version,p.source_fingerprint AS "sourceFingerprint",
      p.snapshot_fingerprint AS "snapshotFingerprint",
      p.created_at AS "createdAt",h.current_proposal_id AS "headId"
    FROM group_settlement_bilateral_proposals p
    JOIN group_settlement_bilateral_heads h
      ON h.group_id=p.group_id AND h.cycle_id=p.cycle_id
      AND h.party_low=p.party_low AND h.party_high=p.party_high
    WHERE p.id=$1 AND p.group_id=$2 AND p.cycle_id=$3
    ${lock?"FOR UPDATE OF p,h":""}`,[proposalId,groupId,cycleId]);
  const p=r.rows[0];
  if(!p)throw error(404,"Không tìm thấy đề xuất bù trừ.");
  return p;
}
async function events(client:PoolClient,id:string){
  const r=await client.query<EventRow>(`SELECT id,event_type AS "eventType",
    actor_id AS "actorId",request_key AS "requestKey",
    request_digest AS "requestDigest",
    source_fingerprint AS "sourceFingerprint",
    recorded_at AS "recordedAt"
    FROM group_settlement_bilateral_decision_events
    WHERE proposal_id=$1 ORDER BY recorded_at,id`,[id]);
  return r.rows;
}
function sha(value:unknown){
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
async function liveMatches(client:PoolClient,p:Proposal,lock:boolean){
  try{
    if(!(await enabled(client,p.groupId)))return false;
    await pairActive(client,p.groupId,p.partyLow,p.partyHigh);
    const c=await cycle(client,p.groupId,p.cycleId,lock);
    if(c.snapshotFingerprint!==p.snapshotFingerprint)return false;
    const live=await computed(client,p.groupId,p.cycleId,c,p.partyLow,p.partyHigh,lock);
    return live.fingerprint===p.sourceFingerprint;
  }catch(e){
    // Ineligible financial sources fail closed. Driver/network/runtime errors
    // must NOT be misclassified as changed money.
    if(e instanceof SettlementError && e.statusCode===409)return false;
    throw e;
  }
}
function project(p:Proposal,history:EventRow[],isLive:boolean,actorId:string,
  now:Date):DecisionView{
  const approvedBy=history.filter(x=>x.eventType==="approve")
    .map(x=>x.actorId).filter((v):v is string=>v!==null);
  const terminal=history.find(x=>
    ["rejected","revoked","invalidated","expired"].includes(
      x.eventType==="reject"?"rejected":
      x.eventType==="revoke"?"revoked":x.eventType));
  const expiredAt=new Date(p.createdAt.getTime()+EXPIRES_MS);
  const isCurrent=p.headId===p.id;
  let status:DecisionStatus;
  if(terminal){
    status=terminal.eventType==="reject"?"rejected":
      terminal.eventType==="revoke"?"revoked":
        terminal.eventType as DecisionStatus;
  }else if(!isCurrent)status="superseded";
  else if(now.getTime()>=expiredAt.getTime())status="expired";
  else if(!isLive)status="invalidated";
  else if(approvedBy.length===2)status="agreed";
  else if(approvedBy.length===1)status="partially_approved";
  else status="pending";
  const open=status==="pending"||status==="partially_approved";
  return {
    proposalId:p.id,version:p.version,sourceFingerprint:p.sourceFingerprint,
    status,isCurrent,expiresAt:expiredAt.toISOString(),
    approvedBy,approvalCount:approvedBy.length,
    readyForApplication:false,financialEngineEnabled:false,
    canApprove:open&&!approvedBy.includes(actorId),
    canReject:open,
    canRevoke:(open||status==="agreed")&&approvedBy.includes(actorId),
    liveMatches:isLive,
    events:history.map(e=>({
      id:e.id,eventType:e.eventType,actorId:e.actorId,
      recordedAt:e.recordedAt.toISOString(),
    })),
  };
}
async function readModel(client:PoolClient,p:Proposal,actorId:string,lock:boolean){
  const history=await events(client,p.id);
  const clock=await client.query<{now:Date}>("SELECT clock_timestamp() AS now");
  const live=await liveMatches(client,p,lock);
  return {history,view:project(p,history,live,actorId,clock.rows[0].now)};
}
/** A read projects time-dependent expiry/staleness without mutating tables.
 * A subsequent action records expired/invalidated as an append-only event.
 */
export async function getBilateralDecisions(groupId:string,cycleId:string,
  proposalId:string,actorId:string):Promise<DecisionView>{
  validateIds(groupId,cycleId,proposalId);
  const client=await pool.connect();
  try{
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await activeGroup(client,groupId,actorId,false);
    const p=await selectProposal(client,groupId,cycleId,proposalId,false);
    if(actorId!==p.partyLow&&actorId!==p.partyHigh)
      throw error(403,"Chỉ hai bên được xem xác nhận bù trừ.");
    const model=await readModel(client,p,actorId,false);
    await client.query("COMMIT");
    return model.view;
  }catch(e){await client.query("ROLLBACK");throw e;}
  finally{client.release();}
}
async function appendEvent(client:PoolClient,p:Proposal,kind:string,
  requestKey:string,digest:string,actorId:string|null){
  const id=randomUUID();
  await client.query(`INSERT INTO group_settlement_bilateral_decision_events
    (id,proposal_id,group_id,cycle_id,party_low,party_high,
     actor_id,event_type,request_key,request_digest,source_fingerprint)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [id,p.id,p.groupId,p.cycleId,p.partyLow,p.partyHigh,
      actorId,kind,requestKey,digest,p.sourceFingerprint]);
  return id;
}
/** An expired/stale action must persist the terminal event before returning
 * HTTP 409. Never throw inside a transaction after inserting that event.
 */
export async function decideBilateralProposal(groupId:string,cycleId:string,
  proposalId:string,actorId:string,input:DecisionRequest){
  validateIds(groupId,cycleId,proposalId);
  if(!input||!["approve","reject","revoke"].includes(input.action)||
    !Number.isSafeInteger(input.expectedVersion)||input.expectedVersion<1||
    !SHA.test(input.expectedFingerprint)||!UUID.test(input.requestKey))
    throw error(400,"Hành động, phiên bản hoặc mã yêu cầu không hợp lệ.");
  const digest=sha(["bn003-decision-v1",proposalId,actorId,input.action,
    input.expectedVersion,input.expectedFingerprint]);
  const result=await transact(async client=>{
    // Same lock order as all cash writers: group -> cycle -> proposal head.
    await activeGroup(client,groupId,actorId,true);
    const p=await selectProposal(client,groupId,cycleId,proposalId,false);
    if(actorId!==p.partyLow&&actorId!==p.partyHigh)
      throw error(403,"Chỉ hai người liên quan mới được quyết định.");
    if(p.version!==input.expectedVersion||
       p.sourceFingerprint!==input.expectedFingerprint)
      throw error(409,"Sai phiên bản hoặc fingerprint đề xuất.");
    // Resolve idempotent response BEFORE rechecking expiry, group opt-out
    // or newly stale money. Never re-run an earlier signed decision.
    const previous=await client.query<EventRow>(`SELECT id,
      event_type AS "eventType",actor_id AS "actorId",
      request_key AS "requestKey",request_digest AS "requestDigest",
      source_fingerprint AS "sourceFingerprint",
      recorded_at AS "recordedAt"
      FROM group_settlement_bilateral_decision_events
      WHERE proposal_id=$1 AND request_key=$2 FOR UPDATE`,
      [p.id,input.requestKey]);
    if(previous.rows[0]){
      if(previous.rows[0].requestDigest!==digest||
         previous.rows[0].actorId!==actorId||
         previous.rows[0].eventType!==input.action)
        throw error(409,"Mã yêu cầu đã sử dụng cho quyết định khác.");
      const view=await readModel(client,p,actorId,false);
      return {decisionId:previous.rows[0].id,alreadyRecorded:true,
        status:view.view.status,view:view.view,conflict:false};
    }
    const reused=await client.query(
      `SELECT proposal_id FROM group_settlement_bilateral_decision_events
       WHERE group_id=$1 AND actor_id=$2 AND request_key=$3
         AND proposal_id<>$4 LIMIT 1`,
      [groupId,actorId,input.requestKey,p.id]);
    if(reused.rowCount)throw error(409,
      "Mã yêu cầu đã sử dụng ở phiên bản đề xuất khác.");
    // BN-004: signed consent is immutable once financially applied.
    // Never allow a late signer revocation (or rejection) after noncash
    // conservation has committed; the application is append-only.
    if(input.action==="revoke"||input.action==="reject"){
      const applied=await client.query(
        `SELECT 1 FROM group_settlement_bilateral_applications
         WHERE proposal_id=$1 LIMIT 1`,[p.id]);
      if(applied.rowCount)throw error(409,
        "Đề xuất đã được ghi bù trừ; không thể thu hồi hoặc từ chối.");
    }
    const c=await cycle(client,groupId,cycleId,true);
    if(c.snapshotFingerprint!==p.snapshotFingerprint)
      throw error(409,"Bản snapshot của kỳ không còn khớp.");
    const locked=await selectProposal(client,groupId,cycleId,proposalId,true);
    const {view}=await readModel(client,locked,actorId,true);
    if(view.status==="superseded")
      throw error(409,"Phiên bản đề xuất đã bị thay thế.");
    if(view.status==="expired"||view.status==="invalidated"){
      const kind=view.status==="expired"?"expired":"invalidated";
      // Existing terminal event is not double-inserted.
      const found=await client.query(
        `SELECT 1 FROM group_settlement_bilateral_decision_events
         WHERE proposal_id=$1 AND event_type IN ('reject','revoke','invalidated','expired')`,
        [p.id]);
      if(!found.rowCount)
        await appendEvent(client,p,kind,randomUUID(),sha(["bn003-auto",kind,p.id]),null);
      return {decisionId:null,alreadyRecorded:false,status:kind,
        view:{...view,status:kind},conflict:true};
    }
    if(view.status==="rejected"||view.status==="revoked")
      throw error(409,"Đề xuất đã bị kết thúc, cần tạo phiên bản mới.");
    if(input.action==="approve"&&!view.canApprove)
      throw error(409,"Bạn đã xác nhận hoặc đề xuất không còn chờ duyệt.");
    if(input.action==="reject"&&!view.canReject)
      throw error(409,"Đề xuất không còn trạng thái chờ để từ chối.");
    if(input.action==="revoke"&&!view.canRevoke)
      throw error(409,"Chỉ người đã xác nhận mới được thu hồi.");
    const decisionId=await appendEvent(client,p,input.action,input.requestKey,
      digest,actorId);
    const after=await readModel(client,p,actorId,false);
    return {decisionId,alreadyRecorded:false,status:after.view.status,
      view:after.view,conflict:false};
  });
  if(result.conflict)throw error(409,result.status==="expired"?
    "Đề xuất đã hết hạn, không thể xác nhận.":"Công nợ hoặc quyền đã thay đổi; xác nhận cũ vô hiệu.");
  return {decisionId:result.decisionId,alreadyRecorded:result.alreadyRecorded,
    status:result.status,view:result.view};
}
