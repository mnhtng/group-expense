import {NextResponse} from "next/server";
import {getCurrentSession} from "@/lib/auth/session";
import {settlementError} from "@/lib/settlement-cycles/http";
import {settlementJson,settlementNoStore} from "@/lib/settlements/http";
import {SettlementSettingsError} from "@/lib/settlement-cycles/settings";
import {listCycleDisputes,openCycleDispute} from "@/lib/settlement-cycles/disputes";

type Context={params:Promise<{groupId:string;cycleId:string}>};
const unauthorized=()=>NextResponse.json({error:"Chưa đăng nhập."},
  {status:401,headers:settlementNoStore});
export async function GET(_request:Request,{params}:Context){
  const session=await getCurrentSession();
  if(!session?.user)return unauthorized();
  try{
    const {groupId,cycleId}=await params;
    return NextResponse.json(await listCycleDisputes(groupId,cycleId,session.user.id),
      {headers:settlementNoStore});
  }catch(e){return settlementError(e);}
}
export async function POST(request:Request,{params}:Context){
  const session=await getCurrentSession();
  if(!session?.user)return unauthorized();
  try{
    const raw=await settlementJson(request);
    if(!raw||typeof raw!=="object"||Array.isArray(raw))
      throw new SettlementSettingsError(400,"Dữ liệu tranh chấp không hợp lệ.");
    const body=raw as Record<string,unknown>;
    const allowed=["obligationId","reason","requestKey"];
    if(Object.keys(body).length!==allowed.length||
      allowed.some(k=>!Object.hasOwn(body,k))||
      Object.keys(body).some(k=>!allowed.includes(k)))
      throw new SettlementSettingsError(400,"Trường tranh chấp không hợp lệ.");
    const {groupId,cycleId}=await params;
    const value=await openCycleDispute(groupId,cycleId,session.user.id,{
      obligationId:body.obligationId as string,
      reason:body.reason as string,requestKey:body.requestKey as string});
    return NextResponse.json(value,{
      status:value.alreadyCreated?200:201,headers:settlementNoStore});
  }catch(e){return settlementError(e);}
}
