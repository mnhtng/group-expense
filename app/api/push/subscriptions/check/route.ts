import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth/session";
import { hasSavedPushSubscription } from "@/lib/notifications/push-store";

const headers = { "Cache-Control": "private, no-store" };

/** An endpoint is a secret; pass it in a POST body, never in a URL or logs. */
export async function POST(request:Request) {
  const session=await getCurrentSession();
  if(!session?.user) {
    return NextResponse.json({error:"Chưa đăng nhập."},{status:401,headers});
  }
  try {
    const raw=await request.text();
    if(raw.length>3_000) {
      return NextResponse.json({error:"Dữ liệu không hợp lệ."},{status:400,headers});
    }
    const data:unknown=JSON.parse(raw);
    const endpoint= data && typeof data==="object" && "endpoint" in data
      ? (data as {endpoint:unknown}).endpoint : undefined;
    return NextResponse.json({
      saved:await hasSavedPushSubscription(session.user.id,endpoint),
    },{headers});
  } catch {
    return NextResponse.json({error:"Không kiểm tra được thiết bị."},{status:400,headers});
  }
}
