import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth/session";
import { notificationList, unreadNotificationCount, NotificationInputError } from "@/lib/notifications/service";
const noStore={"Cache-Control":"private, no-store"};
export async function GET(request:Request) {
  const session=await getCurrentSession();
  if(!session?.user)return NextResponse.json({error:"Chưa đăng nhập."},{status:401,headers:noStore});
  try {
    const query=new URL(request.url).searchParams;
    const limit=query.has("limit")?Number(query.get("limit")):20;
    const cursor=query.get("cursor")??undefined;
    const [{items,nextCursor},unreadCount]=await Promise.all([
      notificationList(session.user.id,limit,cursor),
      unreadNotificationCount(session.user.id),
    ]);
    return NextResponse.json({notifications:items,nextCursor,unreadCount},{headers:noStore});
  } catch(error){
    if(error instanceof NotificationInputError)
      return NextResponse.json({error:error.message},{status:error.status,headers:noStore});
    return NextResponse.json({error:"Không thể tải thông báo."},{status:500,headers:noStore});
  }
}
