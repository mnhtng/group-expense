import {PageHeader} from "@/components/ui/app-screen";
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
    <PageHeader title="Sửa chi cố định" backHref={`/groups/${groupId}/recurring/${ruleId}`} backLabel="Chi cố định"/>
    <ExpenseForm groupId={groupId} members={members} recurringMode recurringRule={rule}/>
  </main>;
}
