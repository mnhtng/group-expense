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
  return <main className="mx-auto min-h-dvh max-w-lg space-y-5 px-5 py-8">
    <Link href={`/groups/${groupId}`} className="text-sm text-muted-foreground">← {group.name}</Link>
    <header>
      <h1 className="text-2xl font-semibold">Sổ công nợ</h1>
      <p className="mt-1 text-sm text-muted-foreground">{debts.length} khoản từ các hóa đơn của nhóm</p>
    </header>
    <div className="rounded-2xl border bg-card p-5">
      <p className="text-sm text-muted-foreground">Tổng công nợ gốc (chưa thanh toán)</p>
      <strong className="mt-2 block text-2xl tabular-nums">{vnd(sumDebtAmounts(debts))}</strong>
    </div>
    {debts.length === 0 && <p className="rounded-xl border border-dashed p-5 text-sm text-muted-foreground">
      Nhóm chưa phát sinh nợ. Hãy tạo hóa đơn và chia phần cho người khác với người thanh toán.
    </p>}
    <div className="space-y-3">
      {debts.map(debt => <Link key={debt.id}
        href={`/groups/${groupId}/debts/${debt.id}`}
        className="block space-y-2 rounded-2xl border bg-card p-4">
        <div className="flex justify-between gap-3 text-sm">
          <span><strong>{debt.debtorName}</strong> <span className="text-muted-foreground">cần trả</span> <strong>{debt.creditorName}</strong></span>
          <strong className="shrink-0 tabular-nums">{vnd(debt.amountMinor)}</strong>
        </div>
        <p className="text-xs text-muted-foreground">{debt.expenseTitle} · {debt.occurredOn} · phiên bản {debt.expenseVersion}</p>
      </Link>)}
    </div>
    <p className="text-xs text-muted-foreground">Chưa hỗ trợ đánh dấu đã trả hoặc cấn trừ giữa các khoản. Sprint 4 sẽ xác nhận thanh toán hai chiều.</p>
  </main>;
}
