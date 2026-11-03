import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth/session";
import { getExpense, updateExpense, deleteExpense } from "@/lib/expenses/service";
import { expenseErrorResponse, noStoreHeaders, readJson } from "@/lib/expenses/http";
import type { ExpenseInput } from "@/lib/expenses/domain";
import { optionalNote } from "@/lib/notes";

type Ctx = { params: Promise<{ groupId: string; expenseId: string }> };
const unauthorized = () => NextResponse.json({ error: "Đăng nhập để tiếp tục." }, { status: 401, headers: noStoreHeaders });

export async function GET(_request: Request, { params }: Ctx) {
  const session = await getCurrentSession();
  if (!session?.user) return unauthorized();
  const { groupId, expenseId } = await params;
  try {
    const expense = await getExpense(groupId, expenseId, session.user.id);
    if (!expense) return NextResponse.json({ error: "Không tìm thấy hóa đơn." }, { status: 404, headers: noStoreHeaders });
    return NextResponse.json({ expense }, { headers: noStoreHeaders });
  } catch (error) { return expenseErrorResponse(error); }
}

export async function PATCH(request: Request, { params }: Ctx) {
  const session = await getCurrentSession();
  if (!session?.user) return unauthorized();
  const { groupId, expenseId } = await params;
  try {
    const body = await readJson(request) as { expectedVersion: number; expense: ExpenseInput };
    const saved = await updateExpense(groupId, expenseId, session.user.id, body?.expectedVersion, body?.expense);
    return NextResponse.json(saved, { headers: noStoreHeaders });
  } catch (error) { return expenseErrorResponse(error); }
}

export async function DELETE(request: Request, { params }: Ctx) {
  const session = await getCurrentSession();
  if (!session?.user) return unauthorized();
  const { groupId, expenseId } = await params;
  try {
    const body = await readJson(request) as { expectedVersion: number; note?: string };
    let note:string|null;
    try {note=optionalNote(body?.note);}
    catch {return NextResponse.json({error:"Ghi chú tối đa 1000 ký tự."},{status:400,headers:noStoreHeaders});}
    const saved = await deleteExpense(groupId, expenseId, session.user.id, body?.expectedVersion,note??"");
    return NextResponse.json(saved, { headers: noStoreHeaders });
  } catch (error) { return expenseErrorResponse(error); }
}
