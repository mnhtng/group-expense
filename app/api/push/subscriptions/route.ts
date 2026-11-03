import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth/session";
import { NotificationInputError } from "@/lib/notifications/service";
import { getPushPreference, subscribePush, unsubscribePush, updatePushPreference } from "@/lib/notifications/push-store";
import { getVapidConfig } from "@/lib/notifications/push-worker";
const noStore={"Cache-Control":"private, no-store"};
function fail(error:unknown) {
  if(error instanceof NotificationInputError)
    return NextResponse.json({error:error.message},{status:error.status,headers:noStore});
  return NextResponse.json({error:"Không thể cấu hình Web Push."},{status:500,headers:noStore});
}
async function body(request:Request):Promise<unknown> {
  const data=await request.text();
  if(data.length>5_000)throw new NotificationInputError(400,"Dữ liệu quá lớn.");
  try{return JSON.parse(data)}catch{throw new NotificationInputError(400,"JSON không hợp lệ.");}
}
export async function GET() {
  const session=await getCurrentSession();
  if(!session?.user)return NextResponse.json({error:"Chưa đăng nhập."},{status:401,headers:noStore});
  const pref=await getPushPreference(session.user.id);
  const vapid=getVapidConfig();
  return NextResponse.json({
    configured:!!vapid,publicKey:vapid?.publicKey??null,
    enabled:pref.enabled,devices:pref.devices,
  },{headers:noStore});
}
export async function POST(request:Request){
  const session=await getCurrentSession();
  if(!session?.user)return NextResponse.json({error:"Chưa đăng nhập."},{status:401,headers:noStore});
  if(!getVapidConfig())return NextResponse.json({error:"Web Push chưa được cấu hình VAPID."},{status:503,headers:noStore});
  try { await subscribePush(session.user.id,await body(request));
    return NextResponse.json({ok:true},{status:201,headers:noStore});
  } catch(error){return fail(error)}
}
export async function DELETE(request:Request){
  const session=await getCurrentSession();
  if(!session?.user)return NextResponse.json({error:"Chưa đăng nhập."},{status:401,headers:noStore});
  try {
    const data=await body(request) as {endpoint?:unknown};
    await unsubscribePush(session.user.id,data?.endpoint);
    return NextResponse.json({ok:true},{headers:noStore});
  } catch(error){return fail(error)}
}
export async function PATCH(request:Request){
  const session=await getCurrentSession();
  if(!session?.user)return NextResponse.json({error:"Chưa đăng nhập."},{status:401,headers:noStore});
  try { const data=await body(request) as {enabled?:unknown};
    await updatePushPreference(session.user.id,data?.enabled);
    return NextResponse.json({ok:true},{headers:noStore});
  }catch(error){return fail(error)}
}
