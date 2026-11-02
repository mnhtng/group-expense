import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { getGroupDetails, listMembers } from "@/lib/groups/service";
import { ExpenseForm } from "@/components/expenses/expense-form";

export default async function NewExpensePage({ params }: {
  params: Promise<{ groupId: string }>
}) {
  const { groupId } = await params;
  const user = await requireUser();
  const group = await getGroupDetails(groupId, user.id);
  if (!group) notFound();
  const members = await listMembers(groupId, user.id);
  return <main className="mx-auto min-h-dvh max-w-lg px-5 pt-6">
    <Link href={`/groups/${groupId}`} className="text-sm text-muted-foreground">← {group.name}</Link>
    <h1 className="my-5 text-2xl font-semibold">Tạo hóa đơn</h1>
    <ExpenseForm groupId={groupId} members={members}/>
  </main>;
}
