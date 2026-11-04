import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { getGroupDetails,listMembers } from "@/lib/groups/service";
import { ExpenseForm } from "@/components/expenses/expense-form";

export default async function NewRecurringPage({params}:{
  params:Promise<{groupId:string}>;
}) {
  const {groupId}=await params;
  const user=await requireUser();
  const group=await getGroupDetails(groupId,user.id);
  if(!group)notFound();
  const members=await listMembers(groupId,user.id);
  return <main className="app-page space-y-5">
    <Link href={`/groups/${groupId}/recurring`} className="text-sm text-muted-foreground">
      ← Chi phí hằng tháng
    </Link>
    <div>
      <h1 className="text-2xl font-semibold">Thêm chi phí cố định</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Thiết lập một lần; hóa đơn mới sẽ phát sinh hằng tháng theo lịch.
      </p>
    </div>
    <ExpenseForm groupId={groupId} members={members} recurringMode/>
  </main>;
}
