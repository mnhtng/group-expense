import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth/session";
import { markNotificationRead, NotificationInputError } from "@/lib/notifications/service";
type Context={params:Promise<{notificationId:string}>};
const noStore={"Cache-Control":"private, no-store"};
export async function PATCH(_request:Request,{params}:Context){
  const session=await getCurrentSession();
  if(!session?.user)return NextResponse.json({error:"Chưa đăng nhập."},{status:401,headers:noStore});
  try {
    await markNotificationRead(session.user.id,(await params).notificationId);
    return NextResponse.json({ok:true},{headers:noStore});
  } catch(error) {
    if(error instanceof NotificationInputError)
      return NextResponse.json({error:error.message},{status:error.status,headers:noStore});
    return NextResponse.json({error:"Không thể xử lý thông báo."},{status:500,headers:noStore});
  }
}
