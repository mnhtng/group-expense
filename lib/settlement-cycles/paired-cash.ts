import "server-only";
import {createHash,randomUUID} from "node:crypto";
import {pool} from "@/lib/db/pool";
import type {PoolClient} from "pg";
import {SettlementError,resolveSettlement} from "@/lib/settlements/service";
import {
  activeGroup,pairActive,cycle,computed,enabled,createBilateralProposal,
} from "@/lib/settlement-cycles/proposals";
import {decideBilateralProposal} from "@/lib/settlement-cycles/decisions";
import {applyBilateralNoncash} from "@/lib/settlement-cycles/applications";
import {previewBilateralResidual,createBilateralResidual}
  from "@/lib/settlement-cycles/residual-repayments";
import {requireEngineAccess} from "@/lib/settlement-cycles/engine";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA=/^[0-9a-f]{64}$/;
const error=(status:400|403|404|409,message:string)=>new SettlementError(status,message);
type Action="start"|"confirm"|"reject"|"cancel";
export type PairCashInput={
  action:Action;otherId:string;expectedVersion:number;
  expectedFingerprint:string;requestKey:string;
};
type Intent={
  id:string;proposalId:string;initiatedBy:string;debtorId:string|null;
  creditorId:string|null;amountMinor:string;status:"pending"|"confirmed"|"rejected"|"cancelled";
  requestKey:string;applicationId:string|null;settlementId:string|null;
};
type Proposal={id:string;version:number;sourceFingerprint:string;flowOrigin:string};
const keyFor=(key:string,step:string)=>{
  const h=createHash("sha256").update(key+":"+step).digest("hex");
  return h.slice(0,8)+"-"+h.slice(8,12)+"-4"+h.slice(13,16)+"-a"+
    h.slice(17,20)+"-"+h.slice(20,32);
};
const intentQuery=`SELECT id,proposal_id AS "proposalId",
  initiated_by AS "initiatedBy",debtor_id AS "debtorId",
  creditor_id AS "creditorId",amount_minor::text AS "amountMinor",
  status,request_key AS "requestKey",application_id AS "applicationId",
  settlement_id AS "settlementId"
  FROM group_settlement_bilateral_cash_intents
  WHERE group_id=$1 AND cycle_id=$2 AND party_low=$3 AND party_high=$4`;
function validate(input:PairCashInput){
  if(!input||!["start","confirm","reject","cancel"].includes(input.action)||
    typeof input.otherId!=="string"||input.otherId.length<1||
    !Number.isSafeInteger(input.expectedVersion)||input.expectedVersion<0||
    !SHA.test(input.expectedFingerprint)||!UUID.test(input.requestKey))
    throw error(400,"Thông tin thanh toán không hợp lệ.");
}
function direction(calculation:Awaited<ReturnType<typeof computed>>["calculation"]){
  const a=BigInt(calculation.aOwesB.availableAfterMinor);
  const b=BigInt(calculation.bOwesA.availableAfterMinor);
  if(a>0n&&b>0n)throw error(409,"Công nợ không bảo toàn sau bù trừ.");
  if(a>0n)return {debtorId:calculation.aOwesB.debtorId,
    creditorId:calculation.aOwesB.creditorId,amountMinor:a.toString()};
  if(b>0n)return {debtorId:calculation.bOwesA.debtorId,
    creditorId:calculation.bOwesA.creditorId,amountMinor:b.toString()};
  return {debtorId:null,creditorId:null,amountMinor:"0"};
}
async function transact<T>(work:(client:PoolClient)=>Promise<T>):Promise<T>{
  const client=await pool.connect();
  try{await client.query("BEGIN");const value=await work(client);
    await client.query("COMMIT");return value;
  }catch(e){await client.query("ROLLBACK");throw e;}
  finally{client.release();}
}
/** The two real actor clicks are BOTH the cash attestation and implicit
 * consent to an exact BN-004 setoff. Neither a unilateral click nor a
 * pending cash intent changes any source balance. On the other person's
 * authenticated confirmation, all of BN-003/004, BN-006 and original cash
 * settlement occur in the SAME transaction (including automatic invoices).
 * No artificial counterparty confirmation or trust in client-supplied money.
 */
export async function processPairCash(groupId:string,cycleId:string,
  actorId:string,input:PairCashInput){
  validate(input);
  if(!UUID.test(groupId)||!UUID.test(cycleId)||actorId===input.otherId)
    throw error(400,"Nhóm, kỳ hoặc hai thành viên không hợp lệ.");
  const [low,high]=actorId<input.otherId?
    [actorId,input.otherId]:[input.otherId,actorId];
  try{
    return await transact(async client=>{
      await activeGroup(client,groupId,actorId,true);
      await pairActive(client,groupId,low,high);
      const access=await requireEngineAccess(client,groupId,"BN004_TEST_ONLY");
      if(!access.bilateralEnabled||!(await enabled(client,groupId)))
        throw error(409,"Nhóm chưa bật quyết toán và bù nợ.");
      const c=await cycle(client,groupId,cycleId,true);
      const all=await client.query<Intent>(intentQuery+
        " ORDER BY created_at DESC,id DESC FOR UPDATE",
        [groupId,cycleId,low,high]);
      const pending=all.rows.find(x=>x.status==="pending");
      if(input.action==="start"){
        const retry=all.rows.find(x=>x.initiatedBy===actorId&&
          x.requestKey===input.requestKey);
        if(retry){
          const original=await client.query<{version:number;fingerprint:string}>(
            `SELECT version,source_fingerprint AS fingerprint
               FROM group_settlement_bilateral_proposals WHERE id=$1`,
            [retry.proposalId],
          );
          if(original.rows[0]?.fingerprint!==input.expectedFingerprint||
             original.rows[0]?.version!==input.expectedVersion+1)
            throw error(409,"Mã thao tác đã dùng với số tiền khác.");
          return {state:retry.status,amountMinor:retry.amountMinor,
            applicationId:retry.applicationId,settlementId:retry.settlementId,
            alreadyProcessed:true};
        }
        if(pending)throw error(409,
          "Người kia đã báo thanh toán. Hãy xác nhận trên thẻ hiện tại.");
        const live=await computed(client,groupId,cycleId,c,low,high,true);
        if(live.fingerprint!==input.expectedFingerprint)
          throw error(409,"Số tiền đã thay đổi. Hãy tải lại.");
        if(live.sources.some(s=>BigInt(s.pendingCashMinor)>0n))
          throw error(409,"Có khoản đang chờ xác nhận. Hãy xử lý khoản đó trước.");
        if(!live.calculation.hasOffset)
          throw error(409,"Cặp này không còn khoản nợ hai chiều để bù.");
        const net=direction(live.calculation);
        const proposal=await createBilateralProposal(groupId,cycleId,actorId,{
          partyAId:low,partyBId:high,expectedVersion:input.expectedVersion,
          expectedFingerprint:input.expectedFingerprint,
          requestKey:keyFor(input.requestKey,"proposal"),flowOrigin:"paired_cash",
        },client);
        await decideBilateralProposal(groupId,cycleId,proposal.proposal.id,actorId,{
          action:"approve",expectedVersion:proposal.proposal.version,
          expectedFingerprint:proposal.proposal.sourceFingerprint,
          requestKey:keyFor(input.requestKey,"first-attestation"),
        },client);
        const intentId=randomUUID();
        await client.query(
          `INSERT INTO group_settlement_bilateral_cash_intents
           (id,proposal_id,group_id,cycle_id,party_low,party_high,
             initiated_by,debtor_id,creditor_id,amount_minor,request_key)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [intentId,proposal.proposal.id,groupId,cycleId,low,high,
            actorId,net.debtorId,net.creditorId,net.amountMinor,input.requestKey],
        );
        return {state:"pending" as const,amountMinor:net.amountMinor,
          initiatedBy:actorId,applicationId:null,settlementId:null,
          alreadyProcessed:false};
      }
      if(!pending){
        if(input.action==="confirm"){
          // Repeated confirmation after a lost HTTP response is safe and
          // does not create a second setoff or cash settlement.
          const done=all.rows.find(x=>x.status==="confirmed"&&
            x.initiatedBy!==actorId);
          if(done)return {state:"confirmed" as const,amountMinor:done.amountMinor,
            applicationId:done.applicationId,settlementId:done.settlementId,
            alreadyProcessed:true};
        }
        throw error(409,"Không có khoản thanh toán đang chờ xác nhận.");
      }
      const other= pending.initiatedBy===low?high:low;
      if(input.action==="cancel"){
        if(actorId!==pending.initiatedBy)
          throw error(403,"Chỉ người báo thanh toán được hủy.");
      }else if(actorId!==other){
        throw error(403,"Chỉ người đối ứng được xác nhận hoặc từ chối.");
      }
      const p=await client.query<Proposal>(
        `SELECT id,version,source_fingerprint AS "sourceFingerprint",
            flow_origin AS "flowOrigin"
          FROM group_settlement_bilateral_proposals
          WHERE id=$1 AND group_id=$2 AND cycle_id=$3 FOR UPDATE`,
        [pending.proposalId,groupId,cycleId],
      );
      const saved=p.rows[0];
      if(!saved||saved.flowOrigin!=="paired_cash")
        throw error(409,"Khoản thanh toán không khớp nguồn bù nợ.");
      if(input.action==="cancel"||input.action==="reject"){
        await decideBilateralProposal(groupId,cycleId,saved.id,actorId,{
          action:input.action==="reject"?"reject":"revoke",
          expectedVersion:saved.version,
          expectedFingerprint:saved.sourceFingerprint,
          requestKey:keyFor(input.requestKey,"decline"),
        },client);
        const status=input.action==="reject"?"rejected":"cancelled";
        await client.query(
          `UPDATE group_settlement_bilateral_cash_intents
            SET status=$2,resolved_by=$3,resolved_at=clock_timestamp()
            WHERE id=$1 AND status='pending'`,
          [pending.id,status,actorId],
        );
        await client.query(
          `SELECT sc009_emit_notice($1,$2,$3,$4,$5,'setoff_decision',$6,$7,$8)`,
          [groupId,cycleId,other,actorId,
            "pair-money-"+status+":"+pending.id,
            status==="rejected"?"Khoản trả bị từ chối":"Đã hủy khoản trả",
            "Chưa có bù nợ hoặc thanh toán nào được ghi.",
            "/groups/"+groupId+"/cycles/"+cycleId],
        );
        return {state:status,amountMinor:pending.amountMinor,
          applicationId:null,settlementId:null,alreadyProcessed:false};
      }
      if(input.expectedFingerprint!==saved.sourceFingerprint||
         input.expectedVersion!==saved.version)
        throw error(409,"Số tiền hoặc kỳ đã thay đổi. Hãy tải lại.");
      const live=await computed(client,groupId,cycleId,c,low,high,true);
      if(live.fingerprint!==saved.sourceFingerprint||
        live.sources.some(s=>BigInt(s.pendingCashMinor)>0n))
        throw error(409,"Số dư thay đổi hoặc còn tiền chờ. Chưa có khoản nào được ghi.");
      const net=direction(live.calculation);
      if(net.amountMinor!==pending.amountMinor||
         net.debtorId!==pending.debtorId||net.creditorId!==pending.creditorId)
        throw error(409,"Khoản chênh lệch không còn khớp. Hãy kiểm tra lại.");
      await decideBilateralProposal(groupId,cycleId,saved.id,actorId,{
        action:"approve",expectedVersion:saved.version,
        expectedFingerprint:saved.sourceFingerprint,
        requestKey:keyFor(input.requestKey,"second-attestation"),
      },client);
      const app=await applyBilateralNoncash(groupId,cycleId,saved.id,actorId,{
        expectedVersion:saved.version,
        expectedFingerprint:saved.sourceFingerprint,
        requestKey:keyFor(input.requestKey,"apply"),
      },client);
      let settlementId:string|null=null;
      if(BigInt(pending.amountMinor)>0n){
        const preview=await previewBilateralResidual(groupId,cycleId,
          app.application.id,actorId,client);
        if(preview.preview.status!=="ready"||
           preview.preview.amountMinor!==pending.amountMinor||
           preview.preview.debtorId!==pending.debtorId||
           preview.preview.creditorId!==pending.creditorId)
          throw error(409,"Tiền còn phải trả đã thay đổi; không được ghi bù nợ một phần.");
        // The earlier actor REALLY signed the original money claim when
        // starting this intent. The currently authenticated second actor
        // is the only confirmer. No actor ID comes from an HTTP payload.
        const cash=await createBilateralResidual(groupId,cycleId,
          app.application.id,pending.initiatedBy,{
            expectedCycleVersion:3,
            expectedFingerprint:preview.preview.fingerprint,
            requestKey:keyFor(pending.requestKey,"cash"),
          },client,{suppressPendingNotification:true});
        settlementId=cash.id;
        await resolveSettlement(groupId,cash.id,actorId,"confirm",undefined,client);
      }
      const updated=await client.query(
        `UPDATE group_settlement_bilateral_cash_intents SET
           status='confirmed',resolved_by=$2,resolved_at=clock_timestamp(),
           application_id=$3,settlement_id=$4
         WHERE id=$1 AND status='pending' RETURNING id`,
        [pending.id,actorId,app.application.id,settlementId],
      );
      if(updated.rowCount!==1)throw error(409,"Khoản thanh toán đã được xử lý.");
      await client.query(
        `SELECT sc009_emit_notice($1,$2,$3,$4,$5,'setoff_applied',$6,$7,$8)`,
        [groupId,cycleId,pending.initiatedBy,actorId,
          "pair-money-confirmed:"+pending.id,
          "Đã hoàn tất thanh toán",
          BigInt(pending.amountMinor)>0n
            ?"Đã xác nhận tiền trả và cấn trừ công nợ."
            :"Đã đối soát và cấn trừ công nợ, không chuyển tiền.",
          "/groups/"+groupId+"/cycles/"+cycleId],
      );
      return {state:"confirmed" as const,amountMinor:pending.amountMinor,
        applicationId:app.application.id,settlementId,alreadyProcessed:false};
    });
  }catch(e){
    if(e instanceof SettlementError)throw e;
    if(e&&typeof e==="object"&&"code" in e&&
      ["23503","23505","23514","P0001","40001","40P01"].includes(String(e.code)))
      throw error(409,"Khoản trả đã thay đổi hoặc vừa được xác nhận.");
    throw e;
  }
}
