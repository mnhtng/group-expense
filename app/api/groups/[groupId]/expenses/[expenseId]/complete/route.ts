import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth/session";
import { completeExpense } from "@/lib/expenses/service";
import { expenseErrorResponse, noStoreHeaders, readJson } from "@/lib/expenses/http";

type Context={params:Promise<{groupId:string;expenseId:string}>};

/** No client-supplied approver ID is trusted; the session identifies the creator. */
export async function POST(request:Request,{params}:Context) {
  const session=await getCurrentSession();
  if(!session?.user)return NextResponse.json(
    {error:"Đăng nhập để tiếp tục."},{status:401,headers:noStoreHeaders},
  );
  try {
    const {groupId,expenseId}=await params;
    const input=await readJson(request) as {expectedVersion?:unknown;note?:unknown};
    const result=await completeExpense(
      groupId,expenseId,session.user.id,
      input?.expectedVersion as number,input?.note,
    );
    return NextResponse.json(result,{headers:noStoreHeaders});
  } catch(error) {return expenseErrorResponse(error);}
}
