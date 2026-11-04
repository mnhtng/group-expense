import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { getGroupDetails,listMembers } from "@/lib/groups/service";
import { getRecurringRule } from "@/lib/recurring/service";
import { ExpenseForm } from "@/components/expenses/expense-form";

export default async function EditRecurringPage({params}:{
  params:Promise<{groupId:string;ruleId:string}>;
}) {
  const {groupId,ruleId}=await params;
  const user=await requireUser();
  const [group,rule,members]=await Promise.all([
    getGroupDetails(groupId,user.id),
    getRecurringRule(groupId,ruleId,user.id),
    listMembers(groupId,user.id),
  ]);
  if(!group||!rule||rule.createdBy!==user.id)notFound();
  return <main className="app-page space-y-5">
    <Link href={`/groups/${groupId}/recurring/${ruleId}`}
      className="text-sm text-muted-foreground">← Chi phí hằng tháng</Link>
    <div>
      <h1 className="text-2xl font-semibold">Sửa mẫu chi phí</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Thay đổi chỉ áp dụng cho các hóa đơn chưa phát sinh.
        Hóa đơn và công nợ các tháng trước không thay đổi.
      </p>
    </div>
    <ExpenseForm groupId={groupId} members={members} recurringMode recurringRule={rule}/>
  </main>;
}
