import {NextResponse} from "next/server";
import {getGroupEngineAccess} from "@/lib/settlement-cycles/engine";
import {getCurrentSession} from "@/lib/auth/session";
import {settlementErrorResponse,settlementJson,settlementNoStore}
  from "@/lib/settlements/http";
import {SettlementError} from "@/lib/settlements/service";
import {
  previewBilateralProposal,createBilateralProposal,
} from "@/lib/settlement-cycles/proposals";

type Context={params:Promise<{groupId:string;cycleId:string}>};
const unauthorized=()=>NextResponse.json({error:"Chưa đăng nhập."},{
  status:401,headers:settlementNoStore});

/** BN-002: preview and immutable *unapproved* proposal documents only.
 * There is no endpoint to approve, reserve or apply noncash debt.
 */
export async function GET(request:Request,{params}:Context){
  const session=await getCurrentSession();
  if(!session?.user)return unauthorized();
  try{
    const {groupId,cycleId}=await params;
    const url=new URL(request.url);
    const keys=[...url.searchParams.keys()];
    if(keys.length!==2||!keys.includes("partyAId")||!keys.includes("partyBId"))
      throw new SettlementError(400,"Cần xác định đúng hai bên đề xuất.");
    const result=await previewBilateralProposal(groupId,cycleId,session.user.id,
      url.searchParams.get("partyAId")??"",url.searchParams.get("partyBId")??"");
    const access=await getGroupEngineAccess(groupId);
    return NextResponse.json({...result,approvalEnabled:access.bilateralEnabled,
      financialEngineEnabled:access.bilateralEnabled},{headers:settlementNoStore});
  }catch(error){return settlementErrorResponse(error);}
}
export async function POST(request:Request,{params}:Context){
  const session=await getCurrentSession();
  if(!session?.user)return unauthorized();
  try{
    const body=await settlementJson(request);
    if(!body||typeof body!=="object"||Array.isArray(body))
      throw new SettlementError(400,"Đề xuất không hợp lệ.");
    const fields=body as Record<string,unknown>;
    const allowed=["partyAId","partyBId","expectedVersion",
      "expectedFingerprint","requestKey"];
    if(Object.keys(fields).length!==allowed.length||
       allowed.some(k=>!Object.hasOwn(fields,k))||
       Object.keys(fields).some(k=>!allowed.includes(k)))
      throw new SettlementError(400,"Trường đề xuất không hợp lệ.");
    const {groupId,cycleId}=await params;
    const saved=await createBilateralProposal(groupId,cycleId,session.user.id,{
      partyAId:fields.partyAId as string,partyBId:fields.partyBId as string,
      expectedVersion:fields.expectedVersion as number,
      expectedFingerprint:fields.expectedFingerprint as string,
      requestKey:fields.requestKey as string,
    });
    const access=await getGroupEngineAccess(groupId);
    return NextResponse.json({...saved,approvalEnabled:access.bilateralEnabled,
      financialEngineEnabled:access.bilateralEnabled},{
      status:saved.alreadyCreated?200:201,headers:settlementNoStore,
    });
  }catch(error){return settlementErrorResponse(error);}
}
