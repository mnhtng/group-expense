import {NextResponse} from "next/server";
import {getCurrentSession} from "@/lib/auth/session";
import {settlementErrorResponse,settlementJson,settlementNoStore}
  from "@/lib/settlements/http";
import {SettlementError} from "@/lib/settlements/service";
import {
  getBilateralApplication,applyBilateralNoncash,
} from "@/lib/settlement-cycles/applications";

type Context={params:Promise<{groupId:string;cycleId:string;proposalId:string}>};
const unauthorized=()=>NextResponse.json({error:"Chưa đăng nhập."},{
  status:401,headers:settlementNoStore});

/** BN-004: immutable NONCASH proof only. No cash payment, invoice closure,
 * original obligation mutation or BN-005 balance integration.
 */
export async function GET(_request:Request,{params}:Context){
  const session=await getCurrentSession();
  if(!session?.user)return unauthorized();
  try{
    const {groupId,cycleId,proposalId}=await params;
    const result=await getBilateralApplication(groupId,cycleId,
      proposalId,session.user.id);
    return NextResponse.json(result,{headers:settlementNoStore});
  }catch(e){return settlementErrorResponse(e);}
}
export async function POST(request:Request,{params}:Context){
  const session=await getCurrentSession();
  if(!session?.user)return unauthorized();
  try{
    const body=await settlementJson(request);
    if(!body||typeof body!=="object"||Array.isArray(body))
      throw new SettlementError(400,"Bút toán bù trừ không hợp lệ.");
    const fields=body as Record<string,unknown>;
    const expected=["expectedVersion","expectedFingerprint","requestKey"];
    if(Object.keys(fields).length!==expected.length||
       expected.some(key=>!Object.hasOwn(fields,key))||
       Object.keys(fields).some(key=>!expected.includes(key)))
      throw new SettlementError(400,"Trường bù trừ không hợp lệ.");
    const {groupId,cycleId,proposalId}=await params;
    const result=await applyBilateralNoncash(groupId,cycleId,proposalId,
      session.user.id,{
        expectedVersion:fields.expectedVersion as number,
        expectedFingerprint:fields.expectedFingerprint as string,
        requestKey:fields.requestKey as string,
      });
    return NextResponse.json(result,{
      status:result.alreadyApplied?200:201,headers:settlementNoStore});
  }catch(e){return settlementErrorResponse(e);}
}
