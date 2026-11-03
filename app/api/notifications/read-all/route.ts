import { NextResponse } from "next/server";
import { withAuthenticatedApi } from "@/lib/security/api-guards";
import { markAllNotificationsRead } from "@/lib/notifications/service";

export const POST = withAuthenticatedApi(async (_request, _context, user) => {
  try {
    const updated = await markAllNotificationsRead(user.id);
    return NextResponse.json({ updated });
  } catch {
    return NextResponse.json({ error: "Không thể đánh dấu đã đọc." }, { status: 500 });
  }
});
