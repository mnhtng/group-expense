import "server-only";
import {timingSafeEqual} from "node:crypto";
/** Reuse Vercel's Cron Bearer secret for internal operations.
 * Never log or return bearer bytes, even on malformed requests.
 */
export function authorizedOpsRequest(request:Request){
  const secret=process.env.CRON_SECRET;
  const auth=request.headers.get("authorization");
  if(!secret||!auth?.startsWith("Bearer "))return false;
  const provided=auth.slice(7);
  const a=Buffer.from(secret,"utf8"),b=Buffer.from(provided,"utf8");
  return a.length===b.length&&a.length>0&&timingSafeEqual(a,b);
}
