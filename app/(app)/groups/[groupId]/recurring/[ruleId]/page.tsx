import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { getGroupDetails } from "@/lib/groups/service";
import {
  getRecurringRule,listRecurringOccurrences,recurringNextDate,
} from "@/lib/recurring/service";
import { formatDateDMY } from "@/lib/date-format";
import { RecurringRuleActions } from "@/components/recurring/recurring-rule-actions";

const vnd=(n:string)=>new Intl.NumberFormat("vi-VN").format(BigInt(n))+" ₫";
export default async function RecurringDetail({params}:{
  params:Promise<{groupId:string;ruleId:string}>;
}) {
  const {groupId,ruleId}=await params;
  const user=await requireUser();
  const [group,rule,history]=await Promise.all([
    getGroupDetails(groupId,user.id),
    getRecurringRule(groupId,ruleId,user.id),
    listRecurringOccurrences(groupId,ruleId,user.id),
  ]);
  if(!group||!rule)notFound();
  return <main className="app-page space-y-5">
    <Link href={`/groups/${groupId}/recurring`} className="text-sm text-muted-foreground">
      ← Chi phí hằng tháng
    </Link>
    <header className="space-y-2 rounded-2xl border bg-card p-5">
      <h1 className="text-2xl font-semibold">{rule.title}</h1>
      <p className="text-2xl font-bold tabular-nums">{vnd(rule.totalMinor)} / tháng</p>
      <p className="text-sm text-muted-foreground">
        Ngày {rule.dayOfMonth} hằng tháng · Người tạo: {rule.creatorName}
      </p>
      <p className="text-sm text-muted-foreground">Người ứng: {rule.payerName}</p>
      {rule.status==="active"&&<p className="text-sm text-muted-foreground">
        Dự kiến: {formatDateDMY(recurringNextDate(rule))}
      </p>}
      {rule.pauseReason&&<p className="text-sm text-destructive">{rule.pauseReason}</p>}
      {rule.notes&&<p className="whitespace-pre-wrap break-words text-sm">{rule.notes}</p>}
    </header>
    {rule.createdBy===user.id&&<div className="space-y-3">
      <Link href={`/groups/${groupId}/recurring/${ruleId}/edit`}
        className="inline-flex min-h-11 items-center rounded-xl border px-4 text-sm font-medium">
        Sửa chi phí định kỳ
      </Link>
      <RecurringRuleActions groupId={groupId} ruleId={ruleId}
        version={rule.version} status={rule.status}/>
    </div>}
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">Hóa đơn đã tạo ({history.length})</h2>
      {history.length===0&&<p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
        Chưa có kỳ nào đến hạn. Nếu hôm nay đến ngày lặp lại, người tạo có thể nhấn “Tạo kỳ đến hạn”.
      </p>}
      {history.map(item=><Link key={item.id}
        href={`/groups/${groupId}/expenses/${item.expenseId}`}
        className="flex min-h-14 items-center justify-between gap-3 rounded-xl border bg-card p-4 text-sm">
        <span className="min-w-0">
          <span className="block font-medium">{formatDateDMY(item.scheduledOn)} · {item.title}</span>
          <span className="mt-1 block text-xs text-muted-foreground">
            {item.completedAt?"Đã hoàn thành":"Đang xử lý công nợ"}
          </span>
        </span>
        <span className="shrink-0">→</span>
      </Link>)}
    </section>
  </main>;
}
