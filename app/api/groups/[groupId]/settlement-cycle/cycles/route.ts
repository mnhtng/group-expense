import {NextResponse} from "next/server";
import {withAuthenticatedApi} from "@/lib/security/api-guards";
import {settlementBody,settlementError} from "@/lib/settlement-cycles/http";
import {
  listSettlementCycles,createManualSettlementCycle,
} from "@/lib/settlement-cycles/lifecycle";

type Context={params:Promise<{groupId:string}>};
export const GET=withAuthenticatedApi<Context>(async(_request,{params},user)=>{
  try{
    const {groupId}=await params;
    return NextResponse.json(await listSettlementCycles(groupId,user.id));
  }catch(cause){return settlementError(cause);}
});
export const POST=withAuthenticatedApi<Context>(async(request,{params},user)=>{
  try{
    const {groupId}=await params;
    const body=await settlementBody(request,
      ["expectedScheduleVersion","requestKey","startDate","endDate"]);
    const cycle=await createManualSettlementCycle(groupId,user.id,{
      expectedScheduleVersion:body.expectedScheduleVersion as number,
      requestKey:body.requestKey as string,
      startDate:body.startDate as string,
      endDate:body.endDate as string,
    });
    return NextResponse.json({cycle},{status:201});
  }catch(cause){return settlementError(cause);}
});
