import {NextResponse} from "next/server";
import {getCurrentSession} from "@/lib/auth/session";
import {settlementError} from "@/lib/settlement-cycles/http";
import {exportCycleCsv} from "@/lib/settlement-cycles/reconciliation";
import {SettlementSettingsError} from "@/lib/settlement-cycles/settings";
type Context={params:Promise<{groupId:string;cycleId:string}>};
export async function GET(req:Request,{params}:Context){
  const session=await getCurrentSession();
  if(!session?.user)return NextResponse.json({error:"Chưa đăng nhập."},
    {status:401,headers:{"Cache-Control":"private, no-store"}});
  try{
    const url=new URL(req.url);
    const kind=url.searchParams.get("kind");
    if((kind!=="ledger"&&kind!=="audit")||
       [...url.searchParams.keys()].some(k=>k!=="kind"))
      throw new SettlementSettingsError(400,"Chọn ledger hoặc audit để xuất CSV.");
    const {groupId,cycleId}=await params;
    const content=await exportCycleCsv(groupId,cycleId,session.user.id,kind);
    return new Response(content,{status:200,headers:{
      "Content-Type":"text/csv; charset=utf-8",
      "Content-Disposition":`attachment; filename="cycle-${cycleId}-${kind}.csv"`,
      "Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff",
    }});
  }catch(e){return settlementError(e);}
}
