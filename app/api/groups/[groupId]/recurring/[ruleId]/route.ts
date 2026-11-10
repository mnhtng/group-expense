import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth/session";
import {
  updateRecurringRule,setRecurringStatus,type RecurringDraft,
} from "@/lib/recurring/service";
import { noStore,readRecurringJson,recurringFailure } from "@/lib/recurring/http";

type Ctx={params:Promise<{groupId:string;ruleId:string}>};
const unauth=()=>NextResponse.json({error:"Đăng nhập để tiếp tục."},{status:401,headers:noStore});
export async function PATCH(request:Request,{params}:Ctx){
  const session=await getCurrentSession();
  if(!session?.user)return unauth();
  const {groupId,ruleId}=await params;
  try{
    const data=await readRecurringJson(request) as {expectedVersion:number;rule:RecurringDraft};
    const result=await updateRecurringRule(groupId,ruleId,session.user.id,
      data?.expectedVersion,data?.rule);
    return NextResponse.json(result,{headers:noStore});
  }catch(error){return recurringFailure(error);}
}
export async function POST(request:Request,{params}:Ctx){
  const session=await getCurrentSession();
  if(!session?.user)return unauth();
  const {groupId,ruleId}=await params;
  try{
    const data=await readRecurringJson(request) as {expectedVersion:number;action:"pause"|"resume"};
    if(data?.action!=="pause"&&data?.action!=="resume")
      return NextResponse.json({error:"Thao tác không hợp lệ."},{status:400,headers:noStore});
    const result=await setRecurringStatus(groupId,ruleId,session.user.id,
      data.expectedVersion,data.action==="pause"?"paused":"active");
    return NextResponse.json(result,{headers:noStore});
  }catch(error){return recurringFailure(error);}
}
