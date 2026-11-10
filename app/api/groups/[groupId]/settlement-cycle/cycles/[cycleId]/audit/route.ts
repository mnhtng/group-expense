import {NextResponse} from "next/server";
import {getCurrentSession} from "@/lib/auth/session";
import {settlementError} from "@/lib/settlement-cycles/http";
import {listCycleAudit} from "@/lib/settlement-cycles/reconciliation";
import {SettlementSettingsError} from "@/lib/settlement-cycles/settings";
type Context={params:Promise<{groupId:string;cycleId:string}>};
export async function GET(req:Request,{params}:Context){
  const session=await getCurrentSession();
  if(!session?.user)return NextResponse.json({error:"Chưa đăng nhập."},
    {status:401,headers:{"Cache-Control":"private, no-store"}});
  try{
    const url=new URL(req.url);
    if([...url.searchParams.keys()].some(k=>k!=="page"))
      throw new SettlementSettingsError(400,"Bộ lọc lịch sử không hợp lệ.");
    const page=Number(url.searchParams.get("page")??"1");
    const {groupId,cycleId}=await params;
    const result=await listCycleAudit(groupId,cycleId,session.user.id,page);
    return NextResponse.json(result,{headers:{"Cache-Control":"private, no-store"}});
  }catch(e){return settlementError(e);}
}
