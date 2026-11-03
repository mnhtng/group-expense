import { NextResponse } from "next/server";
import { withAuthenticatedApi } from "@/lib/security/api-guards";
import { getDebtDetails } from "@/lib/debts/service";

type Context = { params: Promise<{ groupId: string; debtId: string }> };

export const GET = withAuthenticatedApi<Context>(async (_request, { params }, user) => {
  const { groupId, debtId } = await params;
  const detail = await getDebtDetails(groupId, debtId, user.id);
  if (!detail) return NextResponse.json({ error: "Không tìm thấy công nợ." }, { status: 404 });
  return NextResponse.json(detail);
});
