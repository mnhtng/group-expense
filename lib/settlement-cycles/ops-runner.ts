import "server-only";
import {randomUUID} from "node:crypto";
import {pool} from "@/lib/db/pool";
import {generateDueRecurringExpenses} from "@/lib/recurring/service";
import {drainPushQueue} from "@/lib/notifications/push-worker";
import {processCycleMetadataCron} from "@/lib/settlement-cycles/lifecycle";
import {issueCycleReminders} from "@/lib/settlement-cycles/reminders";
import {
  classifyOpsOutcome,operationalAlerts,OPS_LIMITS,
  type OpsCounters,type OpsStageStatus,type OpsOutcome,
} from "@/lib/settlement-cycles/ops-policy";

/** Dedicated session-level advisory lock: all invocations (scheduled and
 * manual replay) share one key, preventing overlapping loops.
 * Leave the lock connection alive until ALL work and audit is finalized.
 */
const LOCK_MAJOR=230010,LOCK_MINOR=2026;
const errName=(error:unknown)=>error instanceof Error?error.name:"Unknown";
export type RunnerResult={
  busy:boolean;runId:string|null;outcome:OpsOutcome|null;
};
export async function runDailySettlementOperations(
  mode:"scheduled"|"manual-replay",
  replayReason?:"retry"|"backlog"|"recovery-drill",
):Promise<RunnerResult>{
  if(mode==="manual-replay"&&!replayReason)
    throw Error("Manual operational replay requires a reason code.");
  const connection=await pool.connect();
  let locked=false,runId:string|null=null;
  try{
    const claim=await connection.query<{acquired:boolean}>(`
      SELECT pg_try_advisory_lock($1::integer,$2::integer) AS acquired`,
      [LOCK_MAJOR,LOCK_MINOR]);
    locked=claim.rows[0]?.acquired===true;
    if(!locked)return {busy:true,runId:null,outcome:null};
    runId=randomUUID();
    await connection.query(`INSERT INTO settlement_cycle_operational_runs
      (id,mode,status) VALUES($1,$2,'running')`,[runId,mode]);

    const [recurring,push]=await Promise.allSettled([
      generateDueRecurringExpenses(undefined,OPS_LIMITS.recurring),
      drainPushQueue(undefined,OPS_LIMITS.push),
    ]);
    const recurringDone=recurring.status==="fulfilled"&&
      recurring.value.errors===0&&
      recurring.value.generated<OPS_LIMITS.recurring&&
      !recurring.value.hasMoreRules;
    // SC-006: never create/review cycle metadata while overdue original
    // recurring invoices might still be missing.
    const cycles=recurringDone
      ?(await Promise.allSettled([
        processCycleMetadataCron(OPS_LIMITS.groups,OPS_LIMITS.perGroup),
      ]))[0]:null;
    const reminders=(await Promise.allSettled([
      issueCycleReminders(OPS_LIMITS.reminders),
    ]))[0];
    // Reminders are committed after the first push drain; drain a second
    // bounded batch to avoid a full-day delay when messages were inserted.
    const reminderPush=reminders.status==="fulfilled"&&
      reminders.value.inserted>0
      ?(await Promise.allSettled([
        drainPushQueue(undefined,OPS_LIMITS.push),
      ]))[0]:null;

    const statuses:OpsStageStatus={
      recurring:recurring.status==="fulfilled"?"ok":"failed",
      push:push.status==="fulfilled"?"ok":"failed",
      cycles:cycles===null?"deferred":
        cycles.status==="fulfilled"?"ok":"failed",
      reminders:reminders.status==="fulfilled"?"ok":"failed",
      reminderPush:reminderPush===null?"not-needed":
        reminderPush.status==="fulfilled"?"ok":"failed",
    };
    // No secrets, invoice names, group IDs or member records in run logs.
    const counters:OpsCounters={
      recurring:recurring.status==="fulfilled"?recurring.value:null,
      push:push.status==="fulfilled"?push.value:null,
      cycles:cycles?.status==="fulfilled"?cycles.value:null,
      reminders:reminders.status==="fulfilled"?reminders.value:null,
      reminderPush:reminderPush?.status==="fulfilled"?reminderPush.value:null,
    };
    for(const [kind,outcome] of [
      ["recurring",recurring],["push",push],["cycles",cycles],
      ["reminders",reminders],["reminderPush",reminderPush],
    ] as const){
      if(outcome?.status==="rejected")
        console.error("Operational stage failed",kind,errName(outcome.reason));
    }
    const summary=classifyOpsOutcome(counters,statuses);
    const stageResults={
      stages:summary.stages,
      counters:summary.counters,
      warningCodes:summary.warningCodes,
      ...(replayReason?{reasonCode:replayReason}:{}),
    };
    await connection.query(`UPDATE settlement_cycle_operational_runs
      SET status=$2,completed_at=clock_timestamp(),
        stage_results=$3::jsonb
      WHERE id=$1 AND status='running'`,
      [runId,summary.status,JSON.stringify(stageResults)]);
    return {busy:false,runId,outcome:summary};
  }catch(error){
    console.error("Operational run interrupted",errName(error));
    if(runId){
      try{
        await connection.query(`UPDATE settlement_cycle_operational_runs
          SET status='failed',completed_at=clock_timestamp(),
            stage_results=$2::jsonb
          WHERE id=$1 AND status='running'`,
          [runId,JSON.stringify({warningCodes:["UNHANDLED_RUN_FAILURE"]})]);
      }catch(e){console.error("Operational audit completion failed",errName(e));}
    }
    throw error;
  }finally{
    if(locked){
      try{await connection.query(`
        SELECT pg_advisory_unlock($1::integer,$2::integer)`,
        [LOCK_MAJOR,LOCK_MINOR]);}
      catch(e){console.error("Operational advisory unlock failed",errName(e));}
    }
    connection.release();
  }
}
export async function readSettlementOpsHealth(){
  const client=await pool.connect();
  try{
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const recent=await client.query<{
      id:string;mode:string;status:string;startedAt:Date;
      completedAt:Date|null;stageResults:Record<string,unknown>;
    }>(`SELECT id,mode,status,started_at AS "startedAt",
       completed_at AS "completedAt",stage_results AS "stageResults"
      FROM settlement_cycle_operational_runs
      ORDER BY started_at DESC,id DESC LIMIT 10`);
    const metrics=await client.query<{
      staleRunning:number;failedCheckpoints:number;deadPushJobs:number;
      pendingPushJobs:number;overdueReviews:number;activeCycleGroups:number;
    }>(`SELECT
      (SELECT count(*)::int FROM settlement_cycle_operational_runs
       WHERE status='running' AND started_at<now()-interval '25 minutes')
       AS "staleRunning",
      (SELECT count(*)::int FROM group_settlement_cycle_cron_checkpoints
       WHERE last_error_at>now()-interval '7 days')
       AS "failedCheckpoints",
      (SELECT count(*)::int FROM notification_push_jobs
       WHERE status='dead') AS "deadPushJobs",
      (SELECT count(*)::int FROM notification_push_jobs
       WHERE status='pending' AND next_attempt_at<=now())
       AS "pendingPushJobs",
      (SELECT count(*)::int FROM group_settlement_cycles cy
       JOIN groups g ON g.id=cy.group_id
       WHERE cy.state='review' AND g.archived_at IS NULL
         AND cy.reviewed_at<now()-interval '48 hours')
       AS "overdueReviews",
      (SELECT count(*)::int FROM group_settlement_settings s
       JOIN groups g ON g.id=s.group_id
       WHERE s.requested_enabled AND g.archived_at IS NULL)
       AS "activeCycleGroups"`);
    const latest=recent.rows.find(row=>row.status!=="running")??null;
    const m=metrics.rows[0];
    const alertCodes=operationalAlerts({
      latestCompletedAt:latest?.completedAt?.toISOString()??null,
      latestStatus:latest?.status??null,
      staleRunning:m.staleRunning,failedCheckpoints:m.failedCheckpoints,
      deadPushJobs:m.deadPushJobs,overdueReviews:m.overdueReviews,
      nowMs:Date.now(),
    });
    await client.query("COMMIT");
    return {
      health:alertCodes.length>0?"attention":"ok",
      alertCodes,
      metrics:m,
      latestRuns:recent.rows.map(row=>({
        id:row.id,mode:row.mode,status:row.status,
        startedAt:row.startedAt.toISOString(),
        completedAt:row.completedAt?.toISOString()??null,
        stageResults:row.stageResults,
      })),
      financialEngineReady:false,
      releaseDecision:"NO-GO" as const,
    };
  }catch(error){await client.query("ROLLBACK");throw error;}
  finally{client.release();}
}
