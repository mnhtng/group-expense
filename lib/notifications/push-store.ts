import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { pool } from "@/lib/db/pool";
import { NotificationInputError } from "@/lib/notifications/service";
const validUrl=(endpoint: unknown): endpoint is string=>{
  if(typeof endpoint!=="string"||endpoint.length>2048)return false;
  try {
    const u=new URL(endpoint);
    // Never allow arbitrary URLs: push endpoints are secrets and are used in
    // server-side outbound requests. Match trusted push services only.
    const h=u.hostname.toLowerCase();
    const trusted=h==="fcm.googleapis.com" || h==="android.googleapis.com" ||
      h==="updates.push.services.mozilla.com" || h==="updates-autopush.stage.mozaws.net" ||
      h==="web.push.apple.com" || h==="push.apple.com" || h.endsWith(".push.apple.com");
    return u.protocol==="https:" && !u.username && !u.password && !u.port &&
      trusted && u.pathname.length>1;
  } catch {return false;}
};
export function validateSubscription(raw:unknown):{
  endpoint:string;keys:{p256dh:string;auth:string}
} {
  if(!raw||typeof raw!=="object")throw new NotificationInputError(400,"Subscription không hợp lệ.");
  const r=raw as {endpoint?:unknown;keys?:{p256dh?:unknown;auth?:unknown}};
  if(!validUrl(r.endpoint)||!r.keys ||
     typeof r.keys.p256dh!=="string"||typeof r.keys.auth!=="string"||
     !/^[\w-]{85,90}$/.test(r.keys.p256dh) ||
     !/^[\w-]{20,25}$/.test(r.keys.auth) ||
     Buffer.from(r.keys.p256dh,"base64url").length!==65 ||
     Buffer.from(r.keys.auth,"base64url").length!==16)
    throw new NotificationInputError(400,"Push subscription không hợp lệ.");
  return {endpoint:r.endpoint,keys:{p256dh:r.keys.p256dh,auth:r.keys.auth}};
}
export async function subscribePush(userId:string,data:unknown) {
  const s=validateSubscription(data);
  const r=await pool.query<{user_id:string}>(
    `INSERT INTO push_subscriptions (id,user_id,endpoint,p256dh,auth)
     VALUES($1,$2,$3,$4,$5)
     ON CONFLICT (endpoint) DO UPDATE SET p256dh=EXCLUDED.p256dh,auth=EXCLUDED.auth,updated_at=now()
     WHERE push_subscriptions.user_id=EXCLUDED.user_id RETURNING user_id`,
    [randomUUID(),userId,s.endpoint,s.keys.p256dh,s.keys.auth]);
  if(!r.rowCount)throw new NotificationInputError(400,"Thiết bị đã được gắn với tài khoản khác.");
}
/** Browser-side subscriptions alone are not proof of server delivery. */
export async function hasSavedPushSubscription(userId:string,endpoint:unknown):Promise<boolean> {
  if(!validUrl(endpoint))return false;
  const result=await pool.query(
    "SELECT 1 FROM push_subscriptions WHERE user_id=$1 AND endpoint=$2 LIMIT 1",
    [userId,endpoint],
  );
  return Boolean(result.rowCount);
}
export async function unsubscribePush(userId:string,endpoint:unknown) {
  if(!validUrl(endpoint))throw new NotificationInputError(400,"Endpoint không hợp lệ.");
  await pool.query("DELETE FROM push_subscriptions WHERE user_id=$1 AND endpoint=$2",[userId,endpoint]);
}
export async function updatePushPreference(userId:string,enabled:unknown) {
  if(typeof enabled!=="boolean")throw new NotificationInputError(400,"Cài đặt không hợp lệ.");
  await pool.query(`INSERT INTO notification_preferences(user_id,push_enabled)
    VALUES($1,$2) ON CONFLICT(user_id) DO UPDATE
    SET push_enabled=EXCLUDED.push_enabled,updated_at=now()`,[userId,enabled]);
}
export async function getPushPreference(userId:string){
  const r=await pool.query<{enabled:boolean;devices:number}>(
    `SELECT COALESCE((SELECT push_enabled FROM notification_preferences WHERE user_id=$1),true)
      AS enabled, (SELECT count(*)::int FROM push_subscriptions WHERE user_id=$1) AS devices`,[userId]);
  return r.rows[0]??{enabled:true,devices:0};
}
export const pushEndpointHash=(endpoint:string)=>createHash("sha256").update(endpoint).digest("hex").slice(0,12);
