import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth/session";
import { listPersonalSettlements } from "@/lib/settlements/service";
import { settlementErrorResponse, settlementNoStore } from "@/lib/settlements/http";

export async function GET() {
  const session=await getCurrentSession();
  if(!session?.user)return NextResponse.json({error:"Chưa đăng nhập."},{status:401,headers:settlementNoStore});
  try{return NextResponse.json({settlements:await listPersonalSettlements(session.user.id)},
    {headers:settlementNoStore});}
  catch(error){return settlementErrorResponse(error)}
}
