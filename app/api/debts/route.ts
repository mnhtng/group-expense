import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth/session";
import { listPersonalDebts } from "@/lib/debts/service";
export async function GET() {
  const session = await getCurrentSession();
  if (!session?.user) return NextResponse.json({ error: "Chưa đăng nhập." }, { status: 401 });
  return NextResponse.json({ debts: await listPersonalDebts(session.user.id) },
    { headers: { "Cache-Control": "private, no-store" } });
}
