import {createHash} from "node:crypto";
import {NextResponse} from "next/server";
import {getCurrentSession} from "@/lib/auth/session";
import {settlementErrorResponse,settlementJson,settlementNoStore}
  from "@/lib/settlements/http";
import {SettlementError} from "@/lib/settlements/service";
import {getGroupEngineAccess} from "@/lib/settlement-cycles/engine";
import {previewBilateralProposal,createBilateralProposal}
  from "@/lib/settlement-cycles/proposals";
import {getBilateralDecisions,decideBilateralProposal}
  from "@/lib/settlement-cycles/decisions";
import {getBilateralApplication,applyBilateralNoncash}
  from "@/lib/settlement-cycles/applications";

type Context={params:Promise<{groupId:string;cycleId:string}>};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA=/^[0-9a-f]{64}$/;
/** Key derivation keeps create/approve/apply idempotent across partial retry.
 * No client may choose whose signature to apply: actor is signed session.
 */
function keyFor(requestKey:string,step:string){
  const h=createHash("sha256").update(requestKey+":"+step).digest("hex");
  return h.slice(0,8)+"-"+h.slice(8,12)+"-4"+h.slice(13,16)+"-a"+
    h.slice(17,20)+"-"+h.slice(20,32);
}
export async function POST(request:Request,{params}:Context){
  const session=await getCurrentSession();
  if(!session?.user)return NextResponse.json({error:"Chưa đăng nhập."},{
    status:401,headers:settlementNoStore});
  try{
    const input=await settlementJson(request);
    if(!input||typeof input!=="object"||Array.isArray(input))
      throw new SettlementError(400,"Thao tác không hợp lệ.");
    const data=input as Record<string,unknown>;
    const required=["action","otherId","requestKey","expectedFingerprint","expectedVersion"];
    if(Object.keys(data).length!==required.length||
       required.some(k=>!Object.hasOwn(data,k))||
       Object.keys(data).some(k=>!required.includes(k))||
       !["agree","reject"].includes(String(data.action))||
       typeof data.otherId!=="string"||!data.otherId.trim()||
       !UUID.test(data.requestKey as string)||
       !SHA.test(data.expectedFingerprint as string)||
       !Number.isSafeInteger(data.expectedVersion)||
       (data.expectedVersion as number)<0)
      throw new SettlementError(400,"Dữ liệu xác nhận bù nợ không hợp lệ.");
    const {groupId,cycleId}=await params;
    const actor=session.user.id,other=data.otherId as string;
    if(actor===other)throw new SettlementError(400,"Cần hai người khác nhau.");
    const access=await getGroupEngineAccess(groupId);
    if(!access.bilateralEnabled)
      throw new SettlementError(409,"Nhóm chưa bật bù nợ hoặc đang tạm dừng.");

    const preview=await previewBilateralProposal(groupId,cycleId,actor,actor,other);
    const current=preview.current;
    // A financial action must be explicitly based on the numbers the user saw.
    if(preview.fingerprint!==data.expectedFingerprint)
      throw new SettlementError(409,"Số tiền đã thay đổi, vui lòng xem lại.");
    if(current){
      const existing=await getBilateralApplication(groupId,cycleId,current.id,actor);
      if(existing.application)return NextResponse.json({
        state:"applied",applicationId:existing.application.id,alreadyApplied:true,
      },{headers:settlementNoStore});
    }

    if(data.action==="reject"&&!current)
      throw new SettlementError(409,"Không có khoản bù nợ chờ phản hồi.");

    let doc=current;
    if(doc&&data.action==="agree"){
      const before=await getBilateralDecisions(groupId,cycleId,doc.id,actor);
      // A rejected/revoked/expired document is history, not a new vote.
      if(["rejected","revoked","invalidated","expired","superseded"].includes(before.status))
        doc=null;
    }
    if(!doc){
      const created=await createBilateralProposal(groupId,cycleId,actor,{
        partyAId:actor,partyBId:other,
        expectedVersion:data.expectedVersion as number,
        expectedFingerprint:data.expectedFingerprint as string,
        requestKey:keyFor(data.requestKey as string,"proposal"),
      });
      doc=created.proposal;
    }

    let decision=await getBilateralDecisions(groupId,cycleId,doc.id,actor);
    if(data.action==="reject"){
      if(!decision.canReject)throw new SettlementError(409,"Không còn khoản chờ để từ chối.");
      decision=(await decideBilateralProposal(groupId,cycleId,doc.id,actor,{
        action:"reject",expectedVersion:doc.version,
        expectedFingerprint:doc.sourceFingerprint,
        requestKey:keyFor(data.requestKey as string,"reject"),
      })).view;
      return NextResponse.json({state:decision.status},{headers:settlementNoStore});
    }

    if(decision.canApprove){
      decision=(await decideBilateralProposal(groupId,cycleId,doc.id,actor,{
        action:"approve",expectedVersion:doc.version,
        expectedFingerprint:doc.sourceFingerprint,
        requestKey:keyFor(data.requestKey as string,"approve"),
      })).view;
    }else if(!decision.approvedBy.includes(actor)||!["agreed","partially_approved"].includes(decision.status)){
      throw new SettlementError(409,"Bù nợ không còn chờ xác nhận. Hãy tải lại.");
    }

    // The SECOND affirmative signature automatically applies the noncash
    // transaction. The existing application DAL re-locks and rechecks source
    // fingerprints, engine gating, two signers and all money invariants.
    if(decision.status==="agreed"){
      const applied=await applyBilateralNoncash(groupId,cycleId,doc.id,actor,{
        expectedVersion:doc.version,expectedFingerprint:doc.sourceFingerprint,
        requestKey:keyFor(data.requestKey as string,"apply"),
      });
      return NextResponse.json({state:"applied",applicationId:applied.application.id,
        autoCompletedCount:applied.autoCompletedCount??0},{headers:settlementNoStore});
    }
    return NextResponse.json({state:"awaiting_other",approvedCount:decision.approvalCount},
      {headers:settlementNoStore});
  }catch(e){return settlementErrorResponse(e);}
}
