import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth/session";
import { markAllNotificationsRead } from "@/lib/notifications/service";
export async function POST(){
  const session=await getCurrentSession();
  if(!session?.user)return NextResponse.json({error:"Chưa đăng nhập."},{status:401});
  try {
    const updated=await markAllNotificationsRead(session.user.id);
    return NextResponse.json({updated},{headers:{"Cache-Control":"private, no-store"}});
  }catch{return NextResponse.json({error:"Không thể đánh dấu đã đọc."},{status:500});}
}
