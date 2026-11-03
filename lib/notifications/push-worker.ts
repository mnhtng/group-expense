import "server-only";
import { pool } from "@/lib/db/pool";
import { sendWebPush, type VapidConfig } from "@/lib/notifications/web-push-crypto";

export function getVapidConfig():VapidConfig|null {
  const publicKey=process.env.VAPID_PUBLIC_KEY;
  const privateKey=process.env.VAPID_PRIVATE_KEY;
  const subject=process.env.VAPID_SUBJECT;
  if(!publicKey||!privateKey||!subject)return null;
  return {publicKey,privateKey,subject};
}
type Job={
  notificationId:string;subscriptionId:string;attempts:number;
  endpoint:string;p256dh:string;auth:string;
  title:string;body:string;href:string;
};
export async function drainPushQueue(settlementId?:string,limit=20) {
  const config=getVapidConfig();
  if(!config)return {claimed:0,sent:0,disabled:true};
  const claim=await pool.query<{notificationId:string;subscriptionId:string;attempts:number}>(
    `WITH candidates AS (
       SELECT j.notification_id,j.subscription_id
       FROM notification_push_jobs j
       JOIN notifications n ON n.id=j.notification_id
       WHERE (($1::uuid IS NULL) OR n.settlement_id=$1)
        AND ((j.status='pending' AND j.next_attempt_at<=now())
          OR (j.status='sending' AND j.lease_until<now()))
        AND j.attempts<5
       ORDER BY j.next_attempt_at
       FOR UPDATE OF j SKIP LOCKED LIMIT $2
     )
     UPDATE notification_push_jobs j SET status='sending',attempts=j.attempts+1,
       lease_until=now()+interval '2 minutes'
     FROM candidates c WHERE j.notification_id=c.notification_id
       AND j.subscription_id=c.subscription_id
     RETURNING j.notification_id AS "notificationId",
       j.subscription_id AS "subscriptionId",j.attempts`,
    [settlementId??null,Math.min(30,Math.max(1,limit))],
  );
  let sent=0;
  for(const claimed of claim.rows) {
    const r=await pool.query<Job>(
      `SELECT j.notification_id AS "notificationId",
       j.subscription_id AS "subscriptionId",j.attempts,
       ps.endpoint,ps.p256dh,ps.auth,
       n.title,n.body,n.href
       FROM notification_push_jobs j
       JOIN push_subscriptions ps ON ps.id=j.subscription_id
       JOIN notifications n ON n.id=j.notification_id
       JOIN notification_preferences pref ON pref.user_id=ps.user_id
       WHERE j.notification_id=$1 AND j.subscription_id=$2 AND pref.push_enabled=true`,
      [claimed.notificationId,claimed.subscriptionId],
    );
    // Preferences default enabled if no explicit row.
    let job=r.rows[0];
    if(!job) {
      const fallback=await pool.query<Job>(
        `SELECT ps.endpoint,ps.p256dh,ps.auth,n.title,n.body,n.href
         FROM push_subscriptions ps JOIN notifications n ON n.id=$1
         WHERE ps.id=$2 AND NOT EXISTS (
           SELECT 1 FROM notification_preferences p
           WHERE p.user_id=ps.user_id AND p.push_enabled=false)`,
        [claimed.notificationId,claimed.subscriptionId],
      );
      job=fallback.rows[0];
    }
    if(!job) {
      await pool.query(`UPDATE notification_push_jobs SET status='dead',
        lease_until=NULL,last_error='Subscription disabled'
        WHERE notification_id=$1 AND subscription_id=$2`,
        [claimed.notificationId,claimed.subscriptionId]);
      continue;
    }
    try {
      const response=await sendWebPush(job,config,{title:job.title,body:job.body,url:job.href});
      if(response.ok) {
        sent++;
        await pool.query(`UPDATE notification_push_jobs SET status='sent',sent_at=now(),
          last_error=NULL,lease_until=NULL WHERE notification_id=$1 AND subscription_id=$2`,
          [claimed.notificationId,claimed.subscriptionId]);
      } else if(response.status===404||response.status===410) {
        await pool.query("DELETE FROM push_subscriptions WHERE id=$1",[claimed.subscriptionId]);
      } else {
        await failure(claimed.notificationId,claimed.subscriptionId,claimed.attempts,
          "Push provider HTTP "+response.status,response.status>=400&&response.status<500&&response.status!==429);
      }
    } catch (err) {
      await failure(claimed.notificationId,claimed.subscriptionId,claimed.attempts,
        err instanceof Error?err.name:"Network failure");
    }
  }
  return {claimed:claim.rowCount??0,sent,disabled:false};
}
async function failure(notificationId:string,subscriptionId:string,attempts:number,
  error:string,permanent=false) {
  await pool.query(
    `UPDATE notification_push_jobs SET
      status=CASE WHEN $4::boolean OR attempts>=5 THEN 'dead' ELSE 'pending' END,
      next_attempt_at=now()+(($3::int * $3::int * 60) * interval '1 second'),
      lease_until=NULL,last_error=left($5,160)
     WHERE notification_id=$1 AND subscription_id=$2`,
    [notificationId,subscriptionId,attempts,permanent,error],
  );
}
