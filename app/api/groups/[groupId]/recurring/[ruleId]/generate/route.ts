import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth/session";
import { getRecurringRule, generateDueRecurringExpenses } from "@/lib/recurring/service";
import { noStore,recurringFailure } from "@/lib/recurring/http";

type Ctx={params:Promise<{groupId:string;ruleId:string}>};
export async function POST(_request:Request,{params}:Ctx){
  const session=await getCurrentSession();
  if(!session?.user)return NextResponse.json({error:"Đăng nhập để tiếp tục."},{status:401,headers:noStore});
  const {groupId,ruleId}=await params;
  try{
    const rule=await getRecurringRule(groupId,ruleId,session.user.id);
    if(!rule)return NextResponse.json({error:"Không tìm thấy mẫu định kỳ."},{status:404,headers:noStore});
    if(rule.createdBy!==session.user.id)return NextResponse.json({error:"Chỉ người tạo được chạy kỳ định kỳ."},{status:403,headers:noStore});
    if(rule.status!=="active")return NextResponse.json({error:"Mẫu đã tạm dừng."},{status:409,headers:noStore});
    const result=await generateDueRecurringExpenses(undefined,12,ruleId);
    if(result.errors)return NextResponse.json({error:"Không tạo được hóa đơn. Hãy thử lại sau."},{status:500,headers:noStore});
    return NextResponse.json(result,{headers:noStore});
  }catch(error){return recurringFailure(error);}
}
