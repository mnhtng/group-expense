import {NextResponse} from "next/server";
import {withAuthenticatedApi} from "@/lib/security/api-guards";
import {settlementBody,settlementError} from "@/lib/settlement-cycles/http";
import {submitSettlementCycleReview} from "@/lib/settlement-cycles/lifecycle";

type Context={params:Promise<{groupId:string;cycleId:string}>};
export const POST=withAuthenticatedApi<Context>(async(request,{params},user)=>{
  try {
    const {groupId,cycleId}=await params;
    const body=await settlementBody(request,["expectedVersion"]);
    return NextResponse.json({
      cycle:await submitSettlementCycleReview(
        groupId,cycleId,user.id,body.expectedVersion as number),
    });
  }catch(cause){return settlementError(cause);}
});
