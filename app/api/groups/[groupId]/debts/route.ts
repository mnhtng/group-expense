import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth/session";
import { listGroupDebts } from "@/lib/debts/service";
type Context = { params: Promise<{ groupId: string }> };
export async function GET(_req: Request, { params }: Context) {
  const session = await getCurrentSession();
  if (!session?.user) return NextResponse.json({ error: "Chưa đăng nhập." }, { status: 401 });
  const { groupId } = await params;
  const debts = await listGroupDebts(groupId, session.user.id);
  if (!debts) return NextResponse.json({ error: "Không tìm thấy nhóm." }, { status: 404 });
  return NextResponse.json({ debts }, { headers: { "Cache-Control": "private, no-store" } });
}
