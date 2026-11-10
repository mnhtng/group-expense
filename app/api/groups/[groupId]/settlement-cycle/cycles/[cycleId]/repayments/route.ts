import {NextResponse,after} from "next/server";
import {getCurrentSession} from "@/lib/auth/session";
import {drainPushQueue} from "@/lib/notifications/push-worker";
import {settlementErrorResponse,settlementJson,settlementNoStore}
  from "@/lib/settlements/http";
import {SettlementError} from "@/lib/settlements/service";
import {createCycleBatchRepayment,listCycleBatchRepayments}
  from "@/lib/settlement-cycles/repayments";
type Context={params:Promise<{groupId:string;cycleId:string}>};
const unauthorized=()=>NextResponse.json(
  {error:"Chưa đăng nhập."},{status:401,headers:settlementNoStore});

/** Everyone in the group can preview only one-direction cash totals.
 * New scoped cash writes require operator admission and explicit group opt-in.
 */
export async function GET(_request:Request,{params}:Context){
  const session=await getCurrentSession();
  if(!session?.user)return unauthorized();
  try{
    const {groupId,cycleId}=await params;
    const value=await listCycleBatchRepayments(groupId,cycleId,session.user.id);
    return NextResponse.json(value,{headers:settlementNoStore});
  }catch(error){return settlementErrorResponse(error);}
}
export async function POST(request:Request,{params}:Context){
  const session=await getCurrentSession();
  if(!session?.user)return unauthorized();
  try{
    const body=await settlementJson(request) as Record<string,unknown>;
    if(!body||Array.isArray(body)||typeof body!=="object"||
       Object.keys(body).some(k=>![
         "expectedCycleVersion","requestKey","debtorId","creditorId",
         "expectedFingerprint","note",
       ].includes(k))||
       ["expectedCycleVersion","requestKey","debtorId","creditorId",
         "expectedFingerprint"].some(k=>!Object.hasOwn(body,k)))
      throw new SettlementError(400,"Trường yêu cầu thanh toán gộp không hợp lệ.");
    const {groupId,cycleId}=await params;
    const saved=await createCycleBatchRepayment(groupId,cycleId,session.user.id,{
      expectedCycleVersion:body.expectedCycleVersion as number,
      requestKey:body.requestKey as string,
      debtorId:body.debtorId as string,
      creditorId:body.creditorId as string,
      expectedFingerprint:body.expectedFingerprint as string,
      note:body.note as string|undefined,
    });
    if(!saved.alreadyCreated)after(async()=>{
      try{await drainPushQueue(saved.id,20);}
      catch{console.error("Batch payment push deferred; retry will handle it.");}
    });
    return NextResponse.json(saved,{
      status:saved.alreadyCreated?200:201,headers:settlementNoStore,
    });
  }catch(error){return settlementErrorResponse(error);}
}
