import {authorizedOpsRequest} from "@/lib/settlement-cycles/ops-auth";
import {runDailySettlementOperations}
  from "@/lib/settlement-cycles/ops-runner";

export const dynamic="force-dynamic";
const noStore={"Cache-Control":"private, no-store",
  "X-Content-Type-Options":"nosniff"};

async function execute(request:Request,mode:"scheduled"|"manual-replay"){
  if(!authorizedOpsRequest(request))
    return Response.json({error:"Unauthorized"},{status:401,headers:noStore});
  const reason=request.headers.get("x-ops-replay-reason");
  if(mode==="manual-replay"&&!["retry","backlog","recovery-drill"].includes(reason??""))
    return Response.json({error:"Manual replay requires an approved reason code"},
      {status:400,headers:noStore});
  try{
    const result=await runDailySettlementOperations(mode,
      mode==="manual-replay"?reason as "retry"|"backlog"|"recovery-drill":undefined);
    if(result.busy)
      return Response.json({status:"already-running",retryable:true},
        {status:202,headers:{...noStore,"Retry-After":"60"}});
    if(!result.outcome)throw Error("Operational outcome missing");
    const {outcome}=result;
    // Preserve existing scheduled Cron response fields for backwards
    // compatibility. All values are sanitized aggregate counts.
    return Response.json({
      runId:result.runId,status:outcome.status,
      warningCodes:outcome.warningCodes,
      recurring:outcome.counters.recurring??{error:"Recurring task failed"},
      push:outcome.counters.push??{error:"Push task failed"},
      cycles:outcome.counters.cycles??{
        error:outcome.stages.cycles==="deferred"?
          "Awaiting recurring catch-up":"Metadata cycle task failed"},
      reminders:outcome.counters.reminders??{error:"Reminder task failed"},
      reminderPush:outcome.counters.reminderPush,
    },{
      status:outcome.status==="success"?200:503,
      headers:{...noStore,...(outcome.status!=="success"?{"Retry-After":"300"}:{})},
    });
  }catch(error){
    console.error("Cron orchestrator failed",
      error instanceof Error?error.name:"Unknown");
    return Response.json({error:"Scheduled operations failed",
      status:"failed"},{status:503,headers:noStore});
  }
}
/** Existing Vercel daily schedule: no financial engine activation. */
export async function GET(request:Request){
  return execute(request,"scheduled");
}
/** Operator-only bounded and idempotent replay using exactly the
 * same Bearer secret and advisory lock, not exposed via a user UI.
 */
export async function POST(request:Request){
  return execute(request,"manual-replay");
}
