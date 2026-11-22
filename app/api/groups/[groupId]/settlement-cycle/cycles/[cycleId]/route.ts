import {NextResponse} from "next/server";
import {withAuthenticatedApi} from "@/lib/security/api-guards";
import {settlementBody,settlementError} from "@/lib/settlement-cycles/http";
import {
  updateManualSettlementCycle,cancelManualSettlementCycle,
} from "@/lib/settlement-cycles/lifecycle";

type Context={params:Promise<{groupId:string;cycleId:string}>};

// An OPEN manual draft may be edited. REVIEW and LOCKED never are.
export const PATCH=withAuthenticatedApi<Context>(async(request,{params},user)=>{
  try{
    const {groupId,cycleId}=await params;
    const body=await settlementBody(request,[
      "expectedVersion","expectedDraftRevision","startDate","endDate",
    ]);
    const cycle=await updateManualSettlementCycle(groupId,cycleId,user.id,{
      expectedVersion:body.expectedVersion as number,
      expectedDraftRevision:body.expectedDraftRevision as number,
      startDate:body.startDate as string,endDate:body.endDate as string,
    });
    return NextResponse.json({cycle},{headers:{"Cache-Control":"private, no-store"}});
  }catch(cause){return settlementError(cause);}
});

// "Delete" is an append-only audited cancellation; the historical record
// remains intact and no previously reviewed/locked period can be cancelled.
export const DELETE=withAuthenticatedApi<Context>(async(request,{params},user)=>{
  try{
    const {groupId,cycleId}=await params;
    const body=await settlementBody(request,["expectedVersion","expectedDraftRevision"]);
    const result=await cancelManualSettlementCycle(groupId,cycleId,user.id,{
      expectedVersion:body.expectedVersion as number,
      expectedDraftRevision:body.expectedDraftRevision as number,
    });
    return NextResponse.json(result,{headers:{"Cache-Control":"private, no-store"}});
  }catch(cause){return settlementError(cause);}
});
