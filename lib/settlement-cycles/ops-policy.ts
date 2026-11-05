/** SC-010: pure, deterministic release-safe operational policy.
 * Never interprets a "successful" Cron as permission to move money.
 * Only numeric counters and stage status may be persisted.
 */
export type OpsCounters={
  recurring:{generated:number;ignored:number;paused:number;errors:number}|null;
  push:{claimed:number;sent:number;disabled:boolean}|null;
  cycles:{groups:number;created:number;reviewed:number;
    skipped:number;errors:number;metadataOnly:boolean}|null;
  reminders:{disabled:boolean;candidates:number;attempted:number;inserted:number}|null;
  reminderPush:{claimed:number;sent:number;disabled:boolean}|null;
};
export type OpsStage="recurring"|"push"|"cycles"|"reminders"|"reminderPush";
export type OpsStageStatus=Record<OpsStage,"ok"|"failed"|"deferred"|"not-needed">;
export type OpsOutcome={
  status:"success"|"partial"|"failed";
  warningCodes:string[];
  counters:OpsCounters;stages:OpsStageStatus;
};
export const OPS_LIMITS={
  recurring:20,groups:30,perGroup:24,push:30,reminders:40,
} as const;
export function classifyOpsOutcome(
 counters:OpsCounters,stages:OpsStageStatus,
):OpsOutcome {
  const warnings:string[]=[];
  const fail=(Object.values(stages).some(s=>s==="failed"))||
    (counters.recurring?.errors??0)>0||
    (counters.cycles?.errors??0)>0;
  if(stages.recurring==="failed"||(counters.recurring?.errors??0)>0)
    warnings.push("RECURRING_FAILED");
  if(stages.cycles==="failed"||(counters.cycles?.errors??0)>0)
    warnings.push("CYCLE_METADATA_FAILED");
  if(stages.push==="failed"||stages.reminderPush==="failed")
    warnings.push("PUSH_FAILED");
  if(stages.reminders==="failed")warnings.push("REMINDERS_FAILED");
  // Caps mean work MAY remain, so never claim "all done". The
  // caller must verify backlog before marking an operational gate green.
  if(counters.recurring&&counters.recurring.generated>=OPS_LIMITS.recurring)
    warnings.push("RECURRING_AT_CAP");
  if(counters.cycles&&counters.cycles.groups>=OPS_LIMITS.groups)
    warnings.push("CYCLES_AT_CAP");
  if(counters.push&&!counters.push.disabled&&
     counters.push.claimed>=OPS_LIMITS.push)
    warnings.push("PUSH_AT_CAP");
  if(counters.reminders&&!counters.reminders.disabled&&
     counters.reminders.attempted>=OPS_LIMITS.reminders)
    warnings.push("REMINDERS_AT_CAP");
  if(counters.reminderPush&&!counters.reminderPush.disabled&&
     counters.reminderPush.claimed>=OPS_LIMITS.push)
    warnings.push("REMINDER_PUSH_AT_CAP");
  if(stages.cycles==="deferred")warnings.push("CYCLES_WAITING_FOR_RECURRING");
  const status=fail?"failed":warnings.length>0?"partial":"success";
  return {status,warningCodes:warnings,counters,stages};
}
export function operationalAlerts(input:{
  latestCompletedAt:string|null;latestStatus:string|null;
  staleRunning:number;failedCheckpoints:number;
  deadPushJobs:number;overdueReviews:number;nowMs:number;
}):string[]{
  const alerts:string[]=[];
  if(!input.latestCompletedAt){
    alerts.push("NO_COMPLETED_CRON_RUN");
  }else if(input.nowMs-Date.parse(input.latestCompletedAt)>36*60*60*1000){
    alerts.push("CRON_LAST_RUN_OLDER_THAN_36_HOURS");
  }
  if(input.latestStatus==="failed"||input.latestStatus==="partial")
    alerts.push("LAST_RUN_NEEDS_OPERATOR_REVIEW");
  if(input.staleRunning>0)alerts.push("STUCK_CRON_RUN");
  if(input.failedCheckpoints>0)alerts.push("RECENT_GROUP_CHECKPOINT_ERRORS");
  if(input.deadPushJobs>0)alerts.push("DEAD_PUSH_DELIVERIES");
  if(input.overdueReviews>0)alerts.push("CYCLES_AWAITING_HUMAN_REVIEW");
  return alerts;
}
