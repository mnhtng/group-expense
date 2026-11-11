import {PageHeader} from "@/components/ui/app-screen";
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
  return <main className="app-page space-y-5">
    <PageHeader title="Thêm khoản chi" backHref={`/groups/${groupId}`} backLabel={group.name}/>
    <ExpenseForm groupId={groupId} members={members}/>
  </main>;
}
