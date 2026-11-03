import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth/session";
import { createSettlement, listGroupSettlements, type CreateSettlementInput } from "@/lib/settlements/service";
import { settlementErrorResponse, settlementJson, settlementNoStore } from "@/lib/settlements/http";
type Context={params:Promise<{groupId:string}>};
export async function GET(_req:Request,{params}:Context){
  const session=await getCurrentSession();
  if(!session?.user)return NextResponse.json({error:"Chưa đăng nhập."},{status:401,headers:settlementNoStore});
  try{
    const result=await listGroupSettlements((await params).groupId,session.user.id);
    if(result===null)return NextResponse.json({error:"Không tìm thấy nhóm."},{status:404,headers:settlementNoStore});
    return NextResponse.json({settlements:result},{headers:settlementNoStore});
  }catch(error){return settlementErrorResponse(error)}
}
export async function POST(req:Request,{params}:Context){
  const session=await getCurrentSession();
  if(!session?.user)return NextResponse.json({error:"Chưa đăng nhập."},{status:401,headers:settlementNoStore});
  try{
    const result=await createSettlement((await params).groupId,session.user.id,
      await settlementJson(req) as CreateSettlementInput);
    return NextResponse.json(result,{status:result.alreadyCreated?200:201,headers:settlementNoStore});
  }catch(error){return settlementErrorResponse(error)}
}
