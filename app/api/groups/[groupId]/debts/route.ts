import { NextResponse } from "next/server";
import { withAuthenticatedApi } from "@/lib/security/api-guards";
import { listGroupDebts } from "@/lib/debts/service";

type Context = { params: Promise<{ groupId: string }> };

export const GET = withAuthenticatedApi<Context>(async (_request, { params }, user) => {
  const { groupId } = await params;
  const debts = await listGroupDebts(groupId, user.id);
  if (!debts) return NextResponse.json({ error: "Không tìm thấy nhóm." }, { status: 404 });
  return NextResponse.json({ debts });
});
