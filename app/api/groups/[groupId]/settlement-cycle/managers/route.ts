import { NextResponse } from "next/server";
import { withAuthenticatedApi } from "@/lib/security/api-guards";
import { settlementBody,settlementError } from "@/lib/settlement-cycles/http";
import { updateSettlementManager } from "@/lib/settlement-cycles/settings";

type Context={params:Promise<{groupId:string}>};
export const POST=withAuthenticatedApi<Context>(async(request,{params},user)=>{
  try {
    const body=await settlementBody(request,["memberId","action"]);
    const memberId=body.memberId;
    const action=body.action;
    if(typeof memberId!=="string"||!memberId||memberId.length>256||
       (action!=="grant"&&action!=="revoke")) {
      return NextResponse.json({error:"Thành viên hoặc thao tác không hợp lệ."},{status:400});
    }
    return NextResponse.json(await updateSettlementManager(
      (await params).groupId,user.id,memberId,action,
    ));
  } catch(error) {return settlementError(error);}
});
