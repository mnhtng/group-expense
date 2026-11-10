import {NextResponse} from "next/server";
import {getGroupEngineAccess} from "@/lib/settlement-cycles/engine";
import {withAuthenticatedApi} from "@/lib/security/api-guards";
import {settlementBody,settlementError} from "@/lib/settlement-cycles/http";
import {inspectCycleSnapshot,lockCycleSnapshot,
  countLateCycleExpenses} from "@/lib/settlement-cycles/snapshot";
type Context={params:Promise<{groupId:string;cycleId:string}>};

export const GET=withAuthenticatedApi<Context>(async(_request,{params},user)=>{
  try{
    const {groupId,cycleId}=await params;
    const snapshot=await inspectCycleSnapshot(groupId,cycleId,user.id);
    return NextResponse.json({
      snapshot,
      lateExpenseCount:snapshot?.state==="locked"
        ? await countLateCycleExpenses(groupId,cycleId,user.id):0,
      financialEngineEnabled:(await getGroupEngineAccess(groupId)).financialEngineEnabled,
    });
  }catch(cause){return settlementError(cause);}
});

/** Snapshot locking does not mark payments paid or invoices complete. */
export const POST=withAuthenticatedApi<Context>(async(request,{params},user)=>{
  try{
    const body=await settlementBody(request,["expectedVersion","requestKey","expectedFingerprint"]);
    const {groupId,cycleId}=await params;
    return NextResponse.json({
      snapshot:await lockCycleSnapshot(groupId,cycleId,user.id,
        body.expectedVersion as number,body.requestKey as string,
        body.expectedFingerprint as string),
      financialEngineEnabled:(await getGroupEngineAccess(groupId)).financialEngineEnabled,
    });
  }catch(cause){return settlementError(cause);}
});
