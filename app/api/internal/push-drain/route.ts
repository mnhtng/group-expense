import { timingSafeEqual } from "node:crypto";
import { drainPushQueue } from "@/lib/notifications/push-worker";
export const runtime="nodejs";
export async function GET(request:Request) {
  const secret=process.env.CRON_SECRET;
  const provided=request.headers.get("authorization")?.replace(/^Bearer /,"")??"";
  const a=Buffer.from(secret??""),b=Buffer.from(provided);
  if(!secret||a.length!==b.length||!timingSafeEqual(a,b))
    return Response.json({error:"Unauthorized"},{status:401});
  try {
    const result=await drainPushQueue(undefined,30);
    return Response.json(result,{headers:{"Cache-Control":"private, no-store"}});
  } catch {
    return Response.json({error:"Delivery retry failed"},{status:500});
  }
}
