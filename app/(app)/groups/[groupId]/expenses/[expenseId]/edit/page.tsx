import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { getGroupDetails, getMemberRole, listMembers } from "@/lib/groups/service";
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
  const role = await getMemberRole(groupId, user.id);
  if (user.id !== expense.createdBy && role !== "owner" && role !== "admin") notFound();
  const members = await listMembers(groupId, user.id);
  return <main className="mx-auto min-h-dvh max-w-lg px-5 pt-6">
    <Link href={`/groups/${groupId}/expenses/${expenseId}`} className="text-sm text-muted-foreground">← Chi tiết hóa đơn</Link>
    <h1 className="my-5 text-2xl font-semibold">Sửa hóa đơn</h1>
    <ExpenseForm groupId={groupId} members={members} expense={expense}/>
  </main>;
}
