import { timingSafeEqual } from "node:crypto";
import { drainPushQueue } from "@/lib/notifications/push-worker";
import { generateDueRecurringExpenses } from "@/lib/recurring/service";
import { processCycleMetadataCron } from "@/lib/settlement-cycles/lifecycle";

/**
 * Reuse the existing single daily Vercel cron. On Hobby, schedules can
 * run only once a day, and only on production deployments.
 * Separate results isolate a temporary push outage from billing creation.
 */
export async function GET(request:Request) {
  const secret=process.env.CRON_SECRET;
  const provided=request.headers.get("authorization")?.replace(/^Bearer /,"")??"";
  const a=Buffer.from(secret??""),b=Buffer.from(provided);
  if(!secret||a.length!==b.length||!timingSafeEqual(a,b))
    return Response.json({error:"Unauthorized"},{status:401});
  const [recurring,push,cycles]=await Promise.allSettled([
    generateDueRecurringExpenses(undefined,20),
    drainPushQueue(undefined,30),
    processCycleMetadataCron(30,24),
  ]);
  if(recurring.status==="rejected")
    console.error("Daily recurring expense task failed",
      recurring.reason instanceof Error?recurring.reason.name:"Unknown");
  if(push.status==="rejected")
    console.error("Daily push delivery task failed",
      push.reason instanceof Error?push.reason.name:"Unknown");
  if(cycles.status==="rejected")
    console.error("Cycle metadata Cron failed",
      cycles.reason instanceof Error?cycles.reason.name:"Unknown");
  // A metadata failure deserves an observable 500 so the job can be retried;
  // finance stays disabled regardless of cron success.
  const failed=recurring.status==="rejected"||push.status==="rejected"||
    cycles.status==="rejected"||
    (cycles.status==="fulfilled"&&cycles.value.errors>0);
  return Response.json({
    recurring:recurring.status==="fulfilled"?recurring.value:{error:"Recurring task failed"},
    push:push.status==="fulfilled"?push.value:{error:"Push delivery failed"},
    cycles:cycles.status==="fulfilled"?cycles.value:{error:"Metadata cycle task failed"},
  },{status:failed?500:200,headers:{"Cache-Control":"private, no-store"}});
}
