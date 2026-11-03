import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { getGroupDetails } from "@/lib/groups/service";
import { listGroupDebts, sumDebtAmounts } from "@/lib/debts/service";

const vnd = (amount: string) => new Intl.NumberFormat("vi-VN").format(BigInt(amount)) + " ₫";

export default async function GroupDebtsPage({ params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;
  const user = await requireUser();
  const [group, debts] = await Promise.all([
    getGroupDetails(groupId, user.id), listGroupDebts(groupId, user.id)
  ]);
  if (!group || !debts) notFound();
  return <main className="app-page space-y-5">
    <Link href={`/groups/${groupId}`} className="text-sm text-muted-foreground">← {group.name}</Link>
    <header>
      <h1 className="text-2xl font-semibold">Sổ công nợ</h1>
      <p className="mt-1 text-sm text-muted-foreground">{debts.length} khoản</p>
    </header>
    <Link href={`/groups/${groupId}/settlements/new`}
      className="block rounded-2xl bg-primary p-4 text-center text-sm font-semibold text-primary-foreground">
      + Ghi nhận thanh toán
    </Link>
    <Link href={`/groups/${groupId}/settlements`}
      className="block rounded-2xl border bg-secondary p-4 text-sm font-semibold">
      Yêu cầu thanh toán →
    </Link>
    <div className="rounded-2xl border bg-card p-5">
      <p className="text-sm text-muted-foreground">Tổng còn nợ</p>
      <strong className="mt-2 block text-2xl tabular-nums">{vnd(sumDebtAmounts(debts.map(x=>({amountMinor:x.outstandingMinor}))))}</strong>
    </div>
    {debts.length === 0 && <p className="rounded-xl border border-dashed p-5 text-sm text-muted-foreground">
      Chưa có công nợ.
    </p>}
    <div className="space-y-3">
      {debts.map(debt => <Link key={debt.id}
        href={`/groups/${groupId}/debts/${debt.id}`}
        className="block space-y-2 rounded-2xl border bg-card p-4">
        <div className="flex justify-between gap-3 text-sm">
          <span><strong>{debt.debtorName}</strong> <span className="text-muted-foreground">cần trả</span> <strong>{debt.creditorName}</strong></span>
          <strong className="shrink-0 tabular-nums">{vnd(debt.outstandingMinor)}</strong>
        </div>
        <p className="text-xs text-muted-foreground">{debt.expenseTitle} · {debt.occurredOn}</p>
        {BigInt(debt.pendingMinor)>0n&&<p className="text-xs text-muted-foreground">Đang chờ: {vnd(debt.pendingMinor)} · Khả dụng: {vnd(debt.availableMinor)}</p>}
        {BigInt(debt.outstandingMinor)===0n&&<p className="text-xs font-semibold">Đã thanh toán đủ</p>}
      </Link>)}
    </div>
  </main>;
}
