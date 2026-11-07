import {NextResponse} from "next/server";
import {getCurrentSession} from "@/lib/auth/session";
import {settlementErrorResponse,settlementJson,settlementNoStore}
  from "@/lib/settlements/http";
import {SettlementError} from "@/lib/settlements/service";
import {
  getBilateralDecisions,decideBilateralProposal,
} from "@/lib/settlement-cycles/decisions";

type Context={params:Promise<{groupId:string;cycleId:string;proposalId:string}>};
const unauthorized=()=>NextResponse.json({error:"Chưa đăng nhập."},{
  status:401,headers:settlementNoStore});

/** No approval here has any effect on the cash or noncash ledger. */
export async function GET(_request:Request,{params}:Context){
  const session=await getCurrentSession();
  if(!session?.user)return unauthorized();
  try{
    const {groupId,cycleId,proposalId}=await params;
    const view=await getBilateralDecisions(groupId,cycleId,proposalId,session.user.id);
    return NextResponse.json(view,{headers:settlementNoStore});
  }catch(e){return settlementErrorResponse(e);}
}
export async function POST(request:Request,{params}:Context){
  const session=await getCurrentSession();
  if(!session?.user)return unauthorized();
  try{
    const body=await settlementJson(request);
    if(!body||typeof body!=="object"||Array.isArray(body))
      throw new SettlementError(400,"Quyết định không hợp lệ.");
    const fields=body as Record<string,unknown>;
    const allowed=["action","expectedVersion","expectedFingerprint","requestKey"];
    if(Object.keys(fields).length!==allowed.length||
       allowed.some(k=>!Object.hasOwn(fields,k))||
       Object.keys(fields).some(k=>!allowed.includes(k)))
      throw new SettlementError(400,"Trường quyết định không hợp lệ.");
    const {groupId,cycleId,proposalId}=await params;
    const result=await decideBilateralProposal(groupId,cycleId,proposalId,
      session.user.id,{
        action:fields.action as "approve"|"reject"|"revoke",
        expectedVersion:fields.expectedVersion as number,
        expectedFingerprint:fields.expectedFingerprint as string,
        requestKey:fields.requestKey as string,
      });
    return NextResponse.json(result,{status:result.alreadyRecorded?200:201,
      headers:settlementNoStore});
  }catch(e){return settlementErrorResponse(e);}
}
