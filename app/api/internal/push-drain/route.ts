import { timingSafeEqual } from "node:crypto";
import { drainPushQueue } from "@/lib/notifications/push-worker";
import { generateDueRecurringExpenses } from "@/lib/recurring/service";
import { processCycleMetadataCron } from "@/lib/settlement-cycles/lifecycle";
import {issueCycleReminders} from "@/lib/settlement-cycles/reminders";

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
  // SC-006: recurring invoices MUST be materialized (with UNIQUE
  // rule+month idempotency) before cycle metadata catch-up/review.
  // Never race two workers against the same group for late historic bills.
  const [recurring,push]=await Promise.allSettled([
    generateDueRecurringExpenses(undefined,20),
    drainPushQueue(undefined,30),
  ]);
  const recurringComplete=recurring.status==="fulfilled" &&
    recurring.value.errors===0 && recurring.value.generated<20;
  const cycles=recurringComplete
    ? (await Promise.allSettled([processCycleMetadataCron(30,24)]))[0]
    : ({status:"rejected",reason:new Error(
      "Recurring catch-up incomplete; cycle metadata deferred safely.")
    } as const);
  if(recurring.status==="rejected")
    console.error("Daily recurring expense task failed",
      recurring.reason instanceof Error?recurring.reason.name:"Unknown");
  if(push.status==="rejected")
    console.error("Daily push delivery task failed",
      push.reason instanceof Error?push.reason.name:"Unknown");
  if(cycles.status==="rejected")
    console.error("Cycle metadata Cron failed",
      cycles.reason instanceof Error?cycles.reason.name:"Unknown");
  const reminders=(await Promise.allSettled([issueCycleReminders(40)]))[0];
  if(reminders.status==="rejected")
    console.error("Cycle reminder Cron failed",
      reminders.reason instanceof Error?reminders.reason.name:"Unknown");
  // Reminders are enqueued after the first push drain; run a second bounded
  // drain only when new notices were inserted, without touching money.
  const reminderPush=reminders.status==="fulfilled"&&reminders.value.inserted>0
    ?(await Promise.allSettled([drainPushQueue(undefined,30)]))[0]
    :null;
  // A metadata failure deserves an observable 500 so the job can be retried;
  // finance stays disabled regardless of cron success.
  const failed=recurring.status==="rejected"||push.status==="rejected"||
    cycles.status==="rejected"||
    (cycles.status==="fulfilled"&&cycles.value.errors>0)||
    reminders.status==="rejected"||
    reminderPush?.status==="rejected";
  return Response.json({
    recurring:recurring.status==="fulfilled"?recurring.value:{error:"Recurring task failed"},
    push:push.status==="fulfilled"?push.value:{error:"Push delivery failed"},
    cycles:cycles.status==="fulfilled"?cycles.value:{error:"Metadata cycle task failed"},
    reminders:reminders.status==="fulfilled"?reminders.value:{error:"Reminder task failed"},
    reminderPush:reminderPush?.status==="fulfilled"?reminderPush.value:
      reminderPush?.status==="rejected"?{error:"Reminder delivery deferred"}:null,
  },{status:failed?500:200,headers:{"Cache-Control":"private, no-store"}});
}
