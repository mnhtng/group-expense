import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth/session";
import { createRecurringRule, listRecurringRules, type RecurringDraft } from "@/lib/recurring/service";
import { noStore,readRecurringJson,recurringFailure } from "@/lib/recurring/http";

type Ctx={params:Promise<{groupId:string}>};
const unauth=()=>NextResponse.json({error:"Đăng nhập để tiếp tục."},{status:401,headers:noStore});
export async function GET(_request:Request,{params}:Ctx) {
  const session=await getCurrentSession();
  if(!session?.user)return unauth();
  const {groupId}=await params;
  try {
    const rules=await listRecurringRules(groupId,session.user.id);
    return NextResponse.json({rules},{headers:noStore});
  } catch(error){return recurringFailure(error);}
}
export async function POST(request:Request,{params}:Ctx) {
  const session=await getCurrentSession();
  if(!session?.user)return unauth();
  const {groupId}=await params;
  try {
    const input=await readRecurringJson(request) as RecurringDraft;
    const rule=await createRecurringRule(groupId,session.user.id,input);
    return NextResponse.json(rule,{status:201,headers:noStore});
  } catch(error){return recurringFailure(error);}
}
