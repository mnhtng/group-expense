import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth/session";
import { getDebtDetails } from "@/lib/debts/service";
type Context = { params: Promise<{ groupId: string; debtId: string }> };
export async function GET(_req: Request, { params }: Context) {
  const session = await getCurrentSession();
  if (!session?.user) return NextResponse.json({ error: "Chưa đăng nhập." }, { status: 401 });
  const { groupId, debtId } = await params;
  const detail = await getDebtDetails(groupId, debtId, session.user.id);
  if (!detail) return NextResponse.json({ error: "Không tìm thấy công nợ." }, { status: 404 });
  return NextResponse.json(detail, { headers: { "Cache-Control": "private, no-store" } });
}
