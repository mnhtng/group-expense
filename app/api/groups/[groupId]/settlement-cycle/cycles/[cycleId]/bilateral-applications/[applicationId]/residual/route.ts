import {NextResponse,after} from "next/server";
import {getCurrentSession} from "@/lib/auth/session";
import {drainPushQueue} from "@/lib/notifications/push-worker";
import {settlementErrorResponse,settlementJson,settlementNoStore}
  from "@/lib/settlements/http";
import {SettlementError} from "@/lib/settlements/service";
import {createBilateralResidual,previewBilateralResidual}
  from "@/lib/settlement-cycles/residual-repayments";

type Context={params:Promise<{
  groupId:string;cycleId:string;applicationId:string;
}>};
const unauthorized=()=>NextResponse.json({error:"Chưa đăng nhập."},{
  status:401,headers:settlementNoStore});

/** BN-006: immutable applied noncash application -> one-direction ORIGINAL
 * cash obligation, PENDING until the actual second person confirms via
 * the existing PATCH /settlements/:id route. No automatic bank transfer.
 */
export async function GET(_request:Request,{params}:Context){
  const session=await getCurrentSession();
  if(!session?.user)return unauthorized();
  try{
    const {groupId,cycleId,applicationId}=await params;
    const result=await previewBilateralResidual(groupId,cycleId,
      applicationId,session.user.id);
    return NextResponse.json(result,{headers:settlementNoStore});
  }catch(error){return settlementErrorResponse(error);}
}
export async function POST(request:Request,{params}:Context){
  const session=await getCurrentSession();
  if(!session?.user)return unauthorized();
  try{
    const body=await settlementJson(request);
    if(!body||Array.isArray(body)||typeof body!=="object")
      throw new SettlementError(400,"Yêu cầu thanh toán chênh lệch không hợp lệ.");
    const fields=body as Record<string,unknown>;
    const required=["expectedCycleVersion","requestKey","expectedFingerprint"];
    const allowed=[...required,"note"];
    if(required.some(k=>!Object.hasOwn(fields,k))||
       Object.keys(fields).some(k=>!allowed.includes(k)))
      throw new SettlementError(400,
        "Chỉ cho phép phiên bản kỳ, fingerprint, requestKey và ghi chú.");
    const {groupId,cycleId,applicationId}=await params;
    const result=await createBilateralResidual(groupId,cycleId,
      applicationId,session.user.id,{
        expectedCycleVersion:fields.expectedCycleVersion as number,
        requestKey:fields.requestKey as string,
        expectedFingerprint:fields.expectedFingerprint as string,
        note:fields.note as string|undefined,
      });
    if(!result.alreadyCreated)after(async()=>{
      try{await drainPushQueue(result.id,20);}
      catch{console.error("BN-006 cash push deferred for retry.");}
    });
    return NextResponse.json(result,{
      status:result.alreadyCreated?200:201,headers:settlementNoStore});
  }catch(error){return settlementErrorResponse(error);}
}
