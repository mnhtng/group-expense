import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth/session";
import { getSettlementDetail, resolveSettlement } from "@/lib/settlements/service";
import { settlementErrorResponse, settlementJson, settlementNoStore } from "@/lib/settlements/http";
type Context={params:Promise<{groupId:string;settlementId:string}>};
export async function GET(_req:Request,{params}:Context){
  const session=await getCurrentSession();
  if(!session?.user)return NextResponse.json({error:"Chưa đăng nhập."},{status:401,headers:settlementNoStore});
  const {groupId,settlementId}=await params;
  try{
    const result=await getSettlementDetail(groupId,settlementId,session.user.id);
    if(!result)return NextResponse.json({error:"Không tìm thấy yêu cầu."},{status:404,headers:settlementNoStore});
    return NextResponse.json({settlement:result},{headers:settlementNoStore});
  }catch(error){return settlementErrorResponse(error)}
}
export async function PATCH(req:Request,{params}:Context){
  const session=await getCurrentSession();
  if(!session?.user)return NextResponse.json({error:"Chưa đăng nhập."},{status:401,headers:settlementNoStore});
  const {groupId,settlementId}=await params;
  try{
    const body=await settlementJson(req) as {action?:"confirm"|"reject"|"cancel";note?:string};
    if(!body||!["confirm","reject","cancel"].includes(body.action??""))
      return NextResponse.json({error:"Trạng thái không hợp lệ."},{status:400,headers:settlementNoStore});
    const result=await resolveSettlement(groupId,settlementId,session.user.id,
      body.action as "confirm"|"reject"|"cancel",body.note);
    return NextResponse.json(result,{headers:settlementNoStore});
  }catch(error){return settlementErrorResponse(error)}
}
