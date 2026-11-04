import { requireUser } from "@/lib/auth/session";
import { getGroupDetails, getMemberRole, listMembers } from "@/lib/groups/service";
import {
  countExpenseStatuses,listExpenses,type ExpenseListFilter,type ExpenseSummary,
} from "@/lib/expenses/service";
import Link from "next/link";
import { formatDateDMY, formatDateTimeDMY } from "@/lib/date-format";
import { notFound, redirect } from "next/navigation";
import { CompleteExpenseButton } from "@/components/expenses/complete-expense-button";

const vnd=(minor:string)=>new Intl.NumberFormat("vi-VN").format(BigInt(minor))+" ₫";

function ExpenseStatus({invoice}:{invoice:ExpenseSummary}) {
  if(invoice.completedAt)return <span className="inline-flex items-center gap-1.5 rounded-full bg-money-in/10 px-2.5 py-1 text-xs font-semibold text-money-in">
    <span aria-hidden="true">✓</span> Đã hoàn thành
  </span>;
  if(BigInt(invoice.remainingMinor)===0n && BigInt(invoice.pendingMinor)===0n)
    return <span className="rounded-full bg-secondary px-2.5 py-1 text-xs font-medium">Chờ chủ hóa đơn chốt</span>;
  if(BigInt(invoice.pendingMinor)>0n)
    return <span className="rounded-full bg-secondary px-2.5 py-1 text-xs font-medium">Chờ xác nhận thanh toán</span>;
  return <span className="rounded-full bg-secondary px-2.5 py-1 text-xs font-medium">Chưa tất toán</span>;
}

export default async function GroupPage({params,searchParams}:{
  params:Promise<{groupId:string}>;
  searchParams:Promise<{invite?:string;invoices?:string}>;
}) {
  const {groupId}=await params;
  const {invite,invoices}=await searchParams;
  const user=await requireUser();
  const role=await getMemberRole(groupId,user.id);
  if(!role)notFound();
  const group=await getGroupDetails(groupId,user.id);
  if(!group)notFound();
  if(invite)redirect(`/groups/${groupId}/manage?invite=${encodeURIComponent(invite)}`);
  const filter:ExpenseListFilter=invoices==="completed"?"completed":"active";
  const [members,expenses,counts]=await Promise.all([
    listMembers(groupId,user.id),
    listExpenses(groupId,user.id,filter),
    countExpenseStatuses(groupId,user.id),
  ]);

  return <main className="app-page space-y-6">
    <Link href="/groups" className="-ml-2 inline-flex min-h-11 items-center rounded-xl px-2 text-sm font-medium text-muted-foreground">
      <span aria-hidden="true" className="mr-2">←</span> Nhóm của tôi
    </Link>
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div className="min-w-0 flex-1">
        <h1 className="break-words text-2xl font-semibold">{group.name}</h1>
        <p className="text-xs text-muted-foreground">{group.currency}</p>
      </div>
      <Link href={`/groups/${groupId}/expenses/new`}
        className="inline-flex min-h-12 shrink-0 items-center justify-center rounded-2xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground">
        + Hóa đơn
      </Link>
    </div>
    <Link href={`/groups/${groupId}/recurring`}
      className="flex min-h-[88px] items-center justify-between gap-4 rounded-3xl border bg-card p-5 transition-colors hover:bg-secondary/40">
      <span>
        <strong className="block">Chi phí cố định hằng tháng</strong>
        <span className="mt-1 block text-sm text-muted-foreground">
          Tạo lịch tự động: tiền nhà, internet, điện nước…
        </span>
      </span>
      <span aria-hidden="true">→</span>
    </Link>
    <Link href={`/groups/${groupId}/debts`}
      className="flex min-h-[88px] items-center justify-between gap-4 rounded-3xl border bg-secondary p-5">
      <span><strong className="block">Công nợ</strong></span>
      <span aria-hidden="true">→</span>
    </Link>

    <section className="space-y-4" aria-label="Danh sách hóa đơn">
      <h2 className="text-lg font-semibold">Hóa đơn</h2>
      <nav aria-label="Lọc hóa đơn" className="grid grid-cols-2 gap-2 rounded-2xl bg-secondary/70 p-1.5">
        <Link href={`/groups/${groupId}`} aria-current={filter==="active"?"page":undefined}
          className={`flex min-h-11 items-center justify-center rounded-xl px-3 text-center text-sm font-semibold transition-colors
            ${filter==="active"?"bg-card shadow-sm":"text-muted-foreground"}`}>
          Đang xử lý ({counts.active})
        </Link>
        <Link href={`/groups/${groupId}?invoices=completed`}
          aria-current={filter==="completed"?"page":undefined}
          className={`flex min-h-11 items-center justify-center rounded-xl px-3 text-center text-sm font-semibold transition-colors
            ${filter==="completed"?"bg-card shadow-sm":"text-muted-foreground"}`}>
          Đã hoàn thành ({counts.completed})
        </Link>
      </nav>

      {expenses.length===0&&<p className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">
        {filter==="completed"
          ?"Chưa có hóa đơn nào được chủ hóa đơn xác nhận hoàn thành."
          :"Không có hóa đơn đang xử lý."}
      </p>}
      {expenses.map(invoice=>{
        const ready = !invoice.completedAt &&
          BigInt(invoice.remainingMinor)===0n && BigInt(invoice.pendingMinor)===0n;
        const creatorCanClose = ready && invoice.createdBy===user.id;
        return <article key={invoice.id}
          className={`overflow-hidden rounded-3xl border
            ${ready?"border-money-in/40 bg-money-in/5":
              invoice.completedAt?"border-money-in/30 bg-money-in/5":"bg-card"}`}>
          <Link href={`/groups/${groupId}/expenses/${invoice.id}`}
            className="block p-4 transition-colors hover:bg-secondary/40 active:bg-secondary/60 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1 space-y-2">
            <h3 className="break-words font-semibold">{invoice.title}</h3>
            {invoice.recurringRuleId&&<span className="inline-block rounded-full bg-secondary px-2.5 py-1 text-xs font-medium">
              ↻ Định kỳ · {invoice.recurringPeriod?formatDateDMY(invoice.recurringPeriod).slice(2):"Hằng tháng"}
            </span>}
            <ExpenseStatus invoice={invoice}/>
            <p className="text-xs text-muted-foreground">
              {formatDateDMY(invoice.occurredOn)} · {invoice.itemCount} món · {invoice.payerName} đã trả
            </p>
            <p className="text-xs text-muted-foreground">Người tạo: {invoice.creatorName}</p>
          </div>
          <strong className="shrink-0 text-sm font-semibold tabular-nums">{vnd(invoice.totalMinor)}</strong>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-xs">
          {invoice.completedAt
            ? <span className="font-medium text-money-in">✓ Chốt ngày {formatDateTimeDMY(invoice.completedAt)}</span>
            : BigInt(invoice.remainingMinor)===0n
              ? <span className="text-money-in">Công nợ đã được xác nhận đầy đủ</span>
              : <span className="text-muted-foreground">
                  Còn phải hoàn trả: <strong className="tabular-nums text-money-out">{vnd(invoice.remainingMinor)}</strong>
                </span>}
          <span className="font-medium">Chi tiết →</span>
        </div>
          </Link>
          {creatorCanClose && <div className="space-y-2 border-t border-money-in/20 px-4 py-4 sm:px-5">
            <p className="text-xs text-money-in">Đã nhận đủ tiền, bạn có thể chốt hóa đơn này.</p>
            <CompleteExpenseButton groupId={groupId} expenseId={invoice.id}
              version={invoice.version} compact />
          </div>}
        </article>;
      })}
      {expenses.length===100&&<p className="text-xs text-muted-foreground">
        Hiển thị 100 hóa đơn gần nhất trong mục này.
      </p>}
    </section>

    <Link href={`/groups/${groupId}/manage`}
      className="flex min-h-[88px] items-center justify-between gap-4 rounded-3xl border bg-card p-5 transition-colors hover:bg-secondary/40 active:bg-secondary/70">
      <span className="min-w-0">
        <strong className="block text-base">Quản lý nhóm</strong>
        <span className="mt-1 block text-sm text-muted-foreground">{members.length} thành viên</span>
      </span>
      <span aria-hidden="true" className="shrink-0 text-xl text-muted-foreground">→</span>
    </Link>
  </main>;
}
