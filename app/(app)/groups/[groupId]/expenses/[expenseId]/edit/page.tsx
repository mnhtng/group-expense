import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { getGroupDetails, listMembers } from "@/lib/groups/service";
import { canModifyExpense } from "@/lib/expenses/permissions";
import { getExpense } from "@/lib/expenses/service";
import { ExpenseForm } from "@/components/expenses/expense-form";

export default async function EditExpensePage({ params }: {
  params: Promise<{ groupId: string; expenseId: string }>
}) {
  const { groupId, expenseId } = await params;
  const user = await requireUser();
  const group = await getGroupDetails(groupId, user.id);
  if (!group) notFound();
  const expense = await getExpense(groupId, expenseId, user.id);
  if (!expense) notFound();
  if (!canModifyExpense(expense.createdBy, user.id)) notFound();
  if (expense.completedAt || BigInt(expense.confirmedMinor)>0n || BigInt(expense.pendingMinor)>0n) notFound();
  const members = await listMembers(groupId, user.id);
  return <main className="app-page">
    <Link href={`/groups/${groupId}/expenses/${expenseId}`} className="text-sm text-muted-foreground">← Chi tiết hóa đơn</Link>
    <h1 className="my-5 text-2xl font-semibold">Sửa hóa đơn</h1>
    <ExpenseForm groupId={groupId} members={members} expense={expense}/>
  </main>;
}
