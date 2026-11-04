import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { getGroupDetails } from "@/lib/groups/service";
import { listRecurringRules, recurringNextDate } from "@/lib/recurring/service";
import { formatDateDMY } from "@/lib/date-format";
import { RecurringRuleActions } from "@/components/recurring/recurring-rule-actions";

const vnd=(value:string)=>new Intl.NumberFormat("vi-VN").format(BigInt(value))+" ₫";
export default async function MonthlyExpensesPage({params}:{
  params:Promise<{groupId:string}>;
}) {
  const {groupId}=await params;
  const user=await requireUser();
  const group=await getGroupDetails(groupId,user.id);
  if(!group)notFound();
  const rules=await listRecurringRules(groupId,user.id);
  const active=rules.filter(rule=>rule.status==="active");
  const paused=rules.filter(rule=>rule.status==="paused");
  return <main className="app-page space-y-5">
    <Link href={`/groups/${groupId}`} className="text-sm text-muted-foreground">
      ← {group.name}
    </Link>
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold">Chi phí hằng tháng</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Tiền thuê nhà, internet, dịch vụ, điện nước cố định...
        </p>
      </div>
      <Link href={`/groups/${groupId}/recurring/new`}
        className="inline-flex min-h-12 items-center rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground">
        + Thêm chi phí
      </Link>
    </header>
    <div className="grid grid-cols-2 gap-3">
      <div className="rounded-2xl border bg-card p-4">
        <p className="text-xs text-muted-foreground">Đang áp dụng</p>
        <p className="mt-2 text-xl font-bold tabular-nums">{active.length} khoản</p>
      </div>
      <div className="rounded-2xl border bg-card p-4">
        <p className="text-xs text-muted-foreground">Tổng dự kiến / tháng</p>
        <p className="mt-2 break-words text-lg font-bold tabular-nums">
          {vnd(active.reduce((sum,r)=>sum+BigInt(r.totalMinor),0n).toString())}
        </p>
      </div>
    </div>
    <p className="text-xs text-muted-foreground">
      Chi phí định kỳ tạo hóa đơn mới khi đến hạn. Mỗi hóa đơn có công nợ và xác nhận thanh toán riêng;
      việc tạo hóa đơn không đồng nghĩa đã thanh toán.
    </p>
    {rules.length===0&&<div className="rounded-2xl border border-dashed p-5 text-sm text-muted-foreground">
      Chưa có chi phí cố định. Thêm mẫu để ứng dụng tự tạo hóa đơn vào ngày đã chọn mỗi tháng.
    </div>}
    {([["Đang hoạt động",active],["Đã tạm dừng",paused]] as const).map(([heading,list])=>
      list.length>0&&<section key={heading} className="space-y-3">
        <h2 className="text-lg font-semibold">{heading} ({list.length})</h2>
        {list.map(rule=><article key={rule.id} className="space-y-3 rounded-2xl border bg-card p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <Link href={`/groups/${groupId}/recurring/${rule.id}`}
                className="block break-words font-semibold underline-offset-4 hover:underline">
                {rule.title}
              </Link>
              <p className="mt-1 text-xs text-muted-foreground">
                Ngày {rule.dayOfMonth} hằng tháng · {rule.payerName} ứng tiền
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Người tạo: {rule.creatorName}
              </p>
            </div>
            <strong className="text-lg font-bold tabular-nums">{vnd(rule.totalMinor)}</strong>
          </div>
          {rule.status==="active"
            ? <p className="text-xs text-muted-foreground">Ngày dự kiến: {formatDateDMY(recurringNextDate(rule))}</p>
            : <p className="text-xs text-muted-foreground">
                {rule.pauseReason??"Đã tạm dừng, không tự tạo hóa đơn mới."}
              </p>}
          {rule.notes&&<p className="whitespace-pre-wrap break-words text-sm">{rule.notes}</p>}
          {rule.createdBy===user.id&&<div className="space-y-3 border-t pt-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Link href={`/groups/${groupId}/recurring/${rule.id}/edit`}
                className="min-h-11 rounded-xl border px-3 py-3 text-sm font-medium">
                Sửa mẫu
              </Link>
              <Link href={`/groups/${groupId}/recurring/${rule.id}`}
                className="text-sm font-medium">Các kỳ đã tạo →</Link>
            </div>
            <RecurringRuleActions groupId={groupId} ruleId={rule.id}
              version={rule.version} status={rule.status}/>
          </div>}
        </article>)}
      </section>
    )}
  </main>;
}
