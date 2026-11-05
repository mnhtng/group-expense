import Link from "next/link";
import { formatDateDMY, formatDateTimeDMY } from "@/lib/date-format";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { getGroupDetails } from "@/lib/groups/service";
import { canModifyExpense } from "@/lib/expenses/permissions";
import { getExpense } from "@/lib/expenses/service";
import { listExpenseDebts } from "@/lib/debts/service";
import { DeleteExpenseButton } from "@/components/expenses/delete-expense-button";
import { CompleteExpenseButton } from "@/components/expenses/complete-expense-button";

const vnd=(amount:string)=>new Intl.NumberFormat("vi-VN").format(BigInt(amount))+" ₫";

export default async function ExpenseDetailPage({params}:{
  params:Promise<{groupId:string;expenseId:string}>;
}) {
  const {groupId,expenseId}=await params;
  const user=await requireUser();
  const group=await getGroupDetails(groupId,user.id);
  if(!group)notFound();
  const expense=await getExpense(groupId,expenseId,user.id);
  if(!expense)notFound();
  const debts=(await listExpenseDebts(groupId,expenseId,user.id))??[];
  const canEdit=canModifyExpense(expense.createdBy,user.id);
  const completed=Boolean(expense.completedAt);
  const remaining=BigInt(expense.remainingMinor);
  const pending=BigInt(expense.pendingMinor);
  const due=BigInt(expense.dueMinor);
  const confirmed=BigInt(expense.confirmedMinor);
  const allSettled=remaining===0n && pending===0n && expense.invalidCount===0;
  const editable=canEdit&&!completed&&confirmed===0n&&pending===0n;
  const percent=due===0n?100:Number((confirmed*100n)/due);
  const status=completed?"Đã hoàn thành"
    :allSettled?"Chờ chủ hóa đơn chốt"
      :pending>0n?"Chờ xác nhận thanh toán":"Đang thanh toán";

  return <main className="app-page space-y-5">
    <Link href={`/groups/${groupId}`} className="text-sm text-muted-foreground">
      ← {group.name}
    </Link>
    <header className={`space-y-4 rounded-2xl border p-5
      ${completed?"border-money-in/40 bg-money-in/5":"bg-card"}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {formatDateDMY(expense.occurredOn)} · {expense.items.length} món
        </p>
        <span className={`rounded-full px-3 py-1 text-xs font-semibold
          ${completed?"bg-money-in/10 text-money-in":"bg-secondary text-foreground"}`}>
          {completed?"✓ ":""}{status}
        </span>
      </div>
      <h1 className="break-words text-2xl font-semibold">{expense.title}</h1>
      {expense.recurringRuleId&&<Link
        href={`/groups/${groupId}/recurring/${expense.recurringRuleId}`}
        className="inline-flex min-h-11 items-center rounded-xl border px-3 text-sm font-medium">
        ↻ Hóa đơn tự động hằng tháng · Xem mẫu định kỳ
      </Link>}
      <p className="text-3xl font-bold tabular-nums">{vnd(expense.totalMinor)}</p>
      <p className="text-sm text-muted-foreground">
        Người tạo: {expense.creatorName} · Người ứng tiền: {expense.payerName}
      </p>
      {expense.notes&&<p className="whitespace-pre-wrap break-words text-sm">{expense.notes}</p>}
      {completed&&<div className="space-y-1 rounded-xl border border-money-in/20 bg-money-in/5 p-3 text-sm">
        <p className="font-semibold text-money-in">✓ Công nợ đã được tất toán và chủ hóa đơn xác nhận</p>
        {expense.completedAt&&<p className="text-muted-foreground">
          Chốt lúc {formatDateTimeDMY(expense.completedAt)} · {expense.creatorName}
        </p>}
        {expense.completionNote&&<p className="whitespace-pre-wrap break-words">
          Ghi chú khi chốt: {expense.completionNote}
        </p>}
        <p className="text-xs text-muted-foreground">
          Hóa đơn được lưu trong mục Đã hoàn thành, không thể sửa hoặc xóa.
        </p>
      </div>}
    </header>

    <section className="space-y-3 rounded-2xl border bg-card p-4">
      <h2 className="text-lg font-semibold">Tiến độ tất toán</h2>
      <p className="text-sm text-muted-foreground">
        {expense.debtorCount===0
          ?"Hóa đơn không phát sinh công nợ giữa các thành viên."
          :`${expense.debtorCount} người có công nợ · ${percent}% đã xác nhận xử lý`}
      </p>
      <div className="h-2.5 overflow-hidden rounded-full bg-secondary"
        role="progressbar" aria-label="Tiến độ xác nhận công nợ"
        aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
        <div className="h-full rounded-full bg-money-in transition-[width]"
          style={{width:`${percent}%`}}/>
      </div>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-4 border-t pt-3 text-sm">
        <div><dt className="text-xs text-muted-foreground">Công nợ phát sinh</dt>
          <dd className="mt-1 font-semibold tabular-nums">{vnd(expense.dueMinor)}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Đã xử lý (tổng)</dt>
          <dd className="mt-1 font-semibold tabular-nums text-money-in">{vnd(expense.confirmedMinor)}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Đã chuyển tiền</dt>
          <dd className="mt-1 font-semibold tabular-nums">{vnd(expense.confirmedCashMinor)}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Bù trừ phi tiền mặt</dt>
          <dd className="mt-1 font-semibold tabular-nums">{vnd(expense.confirmedSetoffMinor)}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Đang chờ xác nhận</dt>
          <dd className="mt-1 font-semibold tabular-nums">{vnd(expense.pendingMinor)}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Còn phải hoàn trả</dt>
          <dd className="mt-1 font-semibold tabular-nums text-money-out">{vnd(expense.remainingMinor)}</dd></div>
      </dl>
      {!completed && allSettled&&<p className="rounded-xl bg-money-in/10 p-3 text-sm text-money-in">
        Tất cả nghĩa vụ đã được xác nhận bằng tiền và/hoặc bù trừ. Chỉ người tạo hóa đơn có thể chốt hoàn thành.
      </p>}
      {!completed && !allSettled&&<p className="text-xs text-muted-foreground">
        Thanh toán đang chờ xác nhận chưa được tính là hoàn trả thành công.
      </p>}
    </section>

    {!completed && allSettled && canEdit &&
      <CompleteExpenseButton groupId={groupId} expenseId={expenseId} version={expense.version}/>}

    <section className="space-y-3">
      <h2 className="text-lg font-semibold">Các món</h2>
      {expense.items.map(item=><section key={item.id} className="space-y-3 rounded-2xl border p-4">
        <div className="flex items-center justify-between gap-3">
          <strong>{item.name}</strong>
          <span className="font-semibold tabular-nums">{vnd(item.amountMinor)}</span>
        </div>
        <p className="text-xs text-muted-foreground">
          {item.quantity} × {vnd(item.unitPriceMinor)}
        </p>
        <div className="space-y-2 border-t pt-3">
          {item.shares.map(share=><div key={share.userId} className="flex justify-between gap-3 text-sm">
            <span>{share.userName}</span>
            <span className="tabular-nums">{vnd(share.amountMinor)}</span>
          </div>)}
        </div>
      </section>)}
    </section>

    <section className="space-y-3">
      <h2 className="text-lg font-semibold">Công nợ theo người ({debts.length})</h2>
      {debts.length===0&&<p className="text-sm text-muted-foreground">
        Hóa đơn này không phát sinh công nợ.
      </p>}
      {debts.map(debt=>{
        const settled=BigInt(debt.outstandingMinor)===0n;
        return <Link key={debt.id} href={`/groups/${groupId}/debts/${debt.id}`}
          className="block space-y-2 rounded-xl border bg-card p-4 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-medium">
              {debt.debtorName} <span className="text-muted-foreground">→</span> {debt.creditorName}
            </span>
            <span className={`rounded-full px-2 py-1 text-xs
              ${settled?"bg-money-in/10 text-money-in":"bg-secondary"}`}>
              {settled?"✓ Đã tất toán":BigInt(debt.pendingMinor)>0n?"Chờ xác nhận":"Chưa tất toán"}
            </span>
          </div>
          <div className="flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
            <span>Gốc: {vnd(debt.amountMinor)} · Đã xử lý: {vnd(debt.confirmedMinor)}</span>
            <strong className={`tabular-nums ${settled?"text-money-in":"text-money-out"}`}>
              {settled?"✓ Đã tất toán":`Còn ${vnd(debt.outstandingMinor)}`}
            </strong>
          </div>
        </Link>;
      })}
    </section>

    {editable&&<div className="flex flex-wrap items-center gap-3">
      <Link href={`/groups/${groupId}/expenses/${expenseId}/edit`}
        className="rounded-xl bg-primary px-4 py-3 text-sm text-primary-foreground">
        Sửa hóa đơn
      </Link>
      <DeleteExpenseButton groupId={groupId} expenseId={expenseId} version={expense.version}/>
    </div>}
    {!canEdit && !completed && <p className="text-sm text-muted-foreground">
      Chỉ người tạo hóa đơn mới có quyền sửa hoặc xóa hóa đơn.
    </p>}
    {canEdit && !completed && !editable && <p className="text-sm text-muted-foreground">
      Hóa đơn đã có thanh toán đang chờ hoặc được xác nhận nên không thể chỉnh sửa.
    </p>}
  </main>;
}
