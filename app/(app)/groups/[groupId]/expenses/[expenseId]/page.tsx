import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { getGroupDetails, getMemberRole } from "@/lib/groups/service";
import { getExpense } from "@/lib/expenses/service";
import { listExpenseDebts } from "@/lib/debts/service";
import { DeleteExpenseButton } from "@/components/expenses/delete-expense-button";

const vnd = (amount: string) => new Intl.NumberFormat("vi-VN").format(BigInt(amount)) + " ₫";

export default async function ExpenseDetailPage({ params }: {
  params: Promise<{ groupId: string; expenseId: string }>
}) {
  const { groupId, expenseId } = await params;
  const user = await requireUser();
  const group = await getGroupDetails(groupId, user.id);
  if (!group) notFound();
  const expense = await getExpense(groupId, expenseId, user.id);
  if (!expense) notFound();
  const debts = (await listExpenseDebts(groupId, expenseId, user.id)) ?? [];
  const role = await getMemberRole(groupId, user.id);
  const canEdit = expense.createdBy === user.id || role === "owner" || role === "admin";
  return <main className="mx-auto min-h-dvh max-w-lg space-y-5 px-5 py-8">
    <Link href={`/groups/${groupId}`} className="text-sm text-muted-foreground">← {group.name}</Link>
    <header className="rounded-2xl border bg-card p-5">
      <p className="text-sm text-muted-foreground">{expense.occurredOn} · {expense.items.length} món</p>
      <h1 className="mt-2 text-2xl font-semibold">{expense.title}</h1>
      <p className="mt-3 text-3xl font-bold tabular-nums">{vnd(expense.totalMinor)}</p>
      <p className="mt-2 text-sm text-muted-foreground">Thanh toán: {expense.payerName}</p>
      {expense.notes && <p className="mt-3 text-sm">{expense.notes}</p>}
    </header>
    <h2 className="text-lg font-semibold">Chi tiết món & phần chia</h2>
    {expense.items.map(item => <section key={item.id} className="space-y-3 rounded-2xl border p-4">
      <div className="flex items-center justify-between gap-3">
        <strong>{item.name}</strong><span className="font-semibold tabular-nums">{vnd(item.amountMinor)}</span>
      </div>
      <p className="text-xs text-muted-foreground">{item.quantity} × {vnd(item.unitPriceMinor)}</p>
      <div className="space-y-2 border-t pt-3">
        {item.shares.map(share => <div key={share.userId} className="flex justify-between text-sm">
          <span>{share.userName}</span>
          <span className="tabular-nums">{vnd(share.amountMinor)}</span>
        </div>)}
      </div>
    </section>)}
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">Công nợ phát sinh ({debts.length})</h2>
      {debts.length === 0 && <p className="text-sm text-muted-foreground">Không phát sinh nợ: người trả cũng là người sử dụng các phần chi phí.</p>}
      {debts.map(debt => <Link key={debt.id}
        href={`/groups/${groupId}/debts/${debt.id}`}
        className="flex justify-between gap-4 rounded-xl border p-3 text-sm">
        <span>{debt.debtorName} <span className="text-muted-foreground">→</span> {debt.creditorName}</span>
        <strong className="tabular-nums">{vnd(debt.amountMinor)}</strong>
      </Link>)}
    </section>
    {canEdit && <div className="flex items-center gap-4">
      <Link href={`/groups/${groupId}/expenses/${expenseId}/edit`}
        className="rounded-xl bg-primary px-4 py-3 text-sm text-primary-foreground">Sửa hóa đơn</Link>
      <DeleteExpenseButton groupId={groupId} expenseId={expenseId} version={expense.version}/>
    </div>}
    <p className="text-xs text-muted-foreground">Lịch sử phiên bản: {expense.version}. Công nợ được tính từ từng món; xác nhận hoàn trả sẽ được bổ sung trong Sprint 4.</p>
  </main>;
}
