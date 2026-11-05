import {NextResponse} from "next/server";
import {getCurrentSession} from "@/lib/auth/session";
import {settlementError} from "@/lib/settlement-cycles/http";
import {readCycleReconciliation} from "@/lib/settlement-cycles/reconciliation";
type Context={params:Promise<{groupId:string;cycleId:string}>};
export async function GET(_req:Request,{params}:Context){
  const session=await getCurrentSession();
  if(!session?.user)return NextResponse.json({error:"Chưa đăng nhập."},
    {status:401,headers:{"Cache-Control":"private, no-store"}});
  try{
    const {groupId,cycleId}=await params;
    const result=await readCycleReconciliation(groupId,cycleId,session.user.id);
    return NextResponse.json(result,{headers:{"Cache-Control":"private, no-store"}});
  }catch(e){return settlementError(e);}
}
