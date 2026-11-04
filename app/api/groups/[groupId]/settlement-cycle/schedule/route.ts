import {NextResponse} from "next/server";
import {withAuthenticatedApi} from "@/lib/security/api-guards";
import {settlementBody,settlementError} from "@/lib/settlement-cycles/http";
import {
  getSettlementSchedule,updateSettlementSchedule,
  type ScheduleInput,
} from "@/lib/settlement-cycles/schedule";
type Context={params:Promise<{groupId:string}>};

export const GET=withAuthenticatedApi<Context>(async(_request,{params},user)=>{
  try {
    return NextResponse.json(
      await getSettlementSchedule((await params).groupId,user.id),
      {headers:{"Cache-Control":"private, no-store"}},
    );
  }catch(error){return settlementError(error);}
});

export const PATCH=withAuthenticatedApi<Context>(async(request,{params},user)=>{
  try {
    const input=await settlementBody(request,
      ["expectedVersion","frequency","timeZone","anchorDate"]);
    const result=await updateSettlementSchedule(
      (await params).groupId,user.id,input as ScheduleInput,
    );
    return NextResponse.json(result,
      {headers:{"Cache-Control":"private, no-store"}});
  }catch(error){return settlementError(error);}
});
