import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth/session";
import { createExpense, listExpenses } from "@/lib/expenses/service";
import { expenseErrorResponse, noStoreHeaders, readJson } from "@/lib/expenses/http";
import type { ExpenseInput } from "@/lib/expenses/domain";

type Ctx = { params: Promise<{ groupId: string }> };

export async function GET(_request: Request, { params }: Ctx) {
  const session = await getCurrentSession();
  if (!session?.user) return NextResponse.json({ error: "Đăng nhập để tiếp tục." }, { status: 401, headers: noStoreHeaders });
  const { groupId } = await params;
  try {
    const expenses = await listExpenses(groupId, session.user.id);
    return NextResponse.json({ expenses }, { headers: noStoreHeaders });
  } catch (error) { return expenseErrorResponse(error); }
}

export async function POST(request: Request, { params }: Ctx) {
  const session = await getCurrentSession();
  if (!session?.user) return NextResponse.json({ error: "Đăng nhập để tiếp tục." }, { status: 401, headers: noStoreHeaders });
  const { groupId } = await params;
  try {
    const body = await readJson(request) as ExpenseInput;
    const saved = await createExpense(groupId, session.user.id, body);
    return NextResponse.json(saved, { status: 201, headers: noStoreHeaders });
  } catch (error) { return expenseErrorResponse(error); }
}
