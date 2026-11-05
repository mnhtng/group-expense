import {NextResponse} from "next/server";
import {getCurrentSession} from "@/lib/auth/session";
import {settlementError} from "@/lib/settlement-cycles/http";
import {settlementJson,settlementNoStore} from "@/lib/settlements/http";
import {SettlementSettingsError} from "@/lib/settlement-cycles/settings";
import {actOnCycleDispute} from "@/lib/settlement-cycles/disputes";

type Context={params:Promise<{groupId:string;cycleId:string;disputeId:string}>};
export async function POST(request:Request,{params}:Context){
  const session=await getCurrentSession();
  if(!session?.user)return NextResponse.json({error:"Chưa đăng nhập."},
    {status:401,headers:settlementNoStore});
  try{
    const raw=await settlementJson(request);
    if(!raw||typeof raw!=="object"||Array.isArray(raw))
      throw new SettlementSettingsError(400,"Dữ liệu phản hồi không hợp lệ.");
    const body=raw as Record<string,unknown>;
    const fields=["eventType","body","requestKey"];
    if(Object.keys(body).length!==fields.length||
       fields.some(k=>!Object.hasOwn(body,k))||
       Object.keys(body).some(k=>!fields.includes(k)))
      throw new SettlementSettingsError(400,"Trường phản hồi không hợp lệ.");
    const {groupId,cycleId,disputeId}=await params;
    const result=await actOnCycleDispute(groupId,cycleId,disputeId,session.user.id,{
      eventType:body.eventType as "respond"|"resolve"|"withdraw",
      body:body.body as string,requestKey:body.requestKey as string});
    return NextResponse.json(result,{status:result.alreadyRecorded?200:201,
      headers:settlementNoStore});
  }catch(e){return settlementError(e);}
}
