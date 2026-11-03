import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { listPersonalDebts, sumDebtAmounts } from "@/lib/debts/service";

const vnd = (amount: string) => new Intl.NumberFormat("vi-VN").format(BigInt(amount)) + " ₫";

export default async function DebtsPage() {
  const user = await requireUser();
  const debts = await listPersonalDebts(user.id);
  const payable = debts.filter(d => d.direction === "pay");
  const receivable = debts.filter(d => d.direction === "receive");
  return <main className="mx-auto min-h-dvh max-w-lg space-y-6 px-5 py-8">
    <header>
      <p className="text-sm text-muted-foreground">Group Expense</p>
      <h1 className="text-2xl font-semibold">Công nợ của tôi</h1>
      <p className="mt-1 text-sm text-muted-foreground">Các khoản đang ghi nhận từ hóa đơn, chưa trừ thanh toán.</p>
    </header>
    <div className="grid grid-cols-2 gap-3">
      <div className="rounded-2xl border bg-card p-4">
        <p className="text-xs text-muted-foreground">Tôi cần trả</p>
        <p className="mt-2 text-lg font-bold tabular-nums">{vnd(sumDebtAmounts(payable))}</p>
      </div>
      <div className="rounded-2xl border bg-card p-4">
        <p className="text-xs text-muted-foreground">Tôi được nhận</p>
        <p className="mt-2 text-lg font-bold tabular-nums">{vnd(sumDebtAmounts(receivable))}</p>
      </div>
    </div>
    {([["Tôi cần trả",payable],["Người khác cần trả tôi",receivable]] as const).map(([heading,rows]) =>
      <section key={heading} className="space-y-3">
        <h2 className="text-lg font-semibold">{heading} ({rows.length})</h2>
        {rows.length === 0 && <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">Không có khoản nợ nào.</p>}
        {rows.map((debt,i) => <Link key={`${debt.groupId}-${debt.counterpartyId}-${debt.direction}-${i}`}
          href={`/groups/${debt.groupId}/debts`}
          className="block rounded-2xl border bg-card p-4">
          <div className="flex items-center justify-between gap-3">
            <strong>{debt.counterpartyName}</strong>
            <strong className="tabular-nums">{vnd(debt.amountMinor)}</strong>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">{debt.groupName} · {debt.obligationCount} khoản theo hóa đơn</p>
        </Link>)}
      </section>
    )}
    <p className="text-xs text-muted-foreground">Các khoản đối ứng chưa được cấn trừ; hệ thống giữ nguyên từng khoản để truy vết. Đánh dấu đã trả/đã nhận và xác nhận hai bên sẽ có trong Sprint 4.</p>
    <Link href="/groups" className="block text-sm underline">← Nhóm của tôi</Link>
  </main>;
}
