import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { listPersonalDebts, sumDebtAmounts } from "@/lib/debts/service";
import { listPersonalSettlements } from "@/lib/settlements/service";

const vnd = (amount: string) => new Intl.NumberFormat("vi-VN").format(BigInt(amount)) + " ₫";

export default async function DebtsPage() {
  const user = await requireUser();
  const [debts,settlements] = await Promise.all([
    listPersonalDebts(user.id),listPersonalSettlements(user.id),
  ]);
  const payable = debts.filter(d => d.direction === "pay");
  const receivable = debts.filter(d => d.direction === "receive");
  return <main className="app-page space-y-6">
    <header>
      <p className="text-sm text-muted-foreground">Group Expense</p>
      <h1 className="text-2xl font-semibold">Công nợ của tôi</h1>
      <p className="mt-1 text-sm text-muted-foreground">Công nợ còn lại đã trừ những khoản được hai bên xác nhận.</p>
    </header>
    <div className="grid grid-cols-2 gap-3">
      <div className="min-w-0 rounded-3xl border bg-card p-4 sm:p-5">
        <p className="text-xs text-muted-foreground">Tôi cần trả</p>
        <p className="mt-2 break-words text-base font-bold tabular-nums sm:text-lg">{vnd(sumDebtAmounts(payable))}</p>
      </div>
      <div className="rounded-2xl border bg-card p-4">
        <p className="text-xs text-muted-foreground">Tôi được nhận</p>
        <p className="mt-2 text-lg font-bold tabular-nums">{vnd(sumDebtAmounts(receivable))}</p>
      </div>
    </div>
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">Yêu cầu đang chờ ({settlements.length})</h2>
      {settlements.length===0&&<p className="rounded-xl border p-3 text-sm text-muted-foreground">Không có giao dịch chờ xác nhận.</p>}
      {settlements.map(s=><Link key={s.id} href={`/groups/${s.groupId}/settlements/${s.id}`}
        className="flex min-h-[72px] justify-between gap-3 rounded-2xl border p-4 text-sm">
        <span><strong>{s.initiatedBy===user.id?"Bạn đã yêu cầu":"Cần bạn xem xét"}</strong>
          <span className="mt-1 block text-xs text-muted-foreground">{s.debtorName} → {s.creditorName} · {s.groupName}</span></span>
        <strong className="tabular-nums">{vnd(s.amountMinor)}</strong>
      </Link>)}
    </section>
    {([["Tôi cần trả",payable],["Người khác cần trả tôi",receivable]] as const).map(([heading,rows]) =>
      <section key={heading} className="space-y-3">
        <h2 className="text-lg font-semibold">{heading} ({rows.length})</h2>
        {rows.length === 0 && <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">Không có khoản nợ nào.</p>}
        {rows.map((debt,i) => <Link key={`${debt.groupId}-${debt.counterpartyId}-${debt.direction}-${i}`}
          href={`/groups/${debt.groupId}/debts`}
          className="block min-h-[88px] rounded-3xl border bg-card p-4 sm:p-5">
          <div className="flex items-center justify-between gap-3">
            <strong>{debt.counterpartyName}</strong>
            <strong className="tabular-nums">{vnd(debt.amountMinor)}</strong>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">{debt.groupName} · {debt.obligationCount} khoản theo hóa đơn</p>
          {BigInt(debt.pendingMinor)>0n&&<p className="mt-1 text-xs text-muted-foreground">
            Đang chờ xác nhận: {vnd(debt.pendingMinor)} · Có thể xử lý: {vnd(debt.availableMinor)}
          </p>}
        </Link>)}
      </section>
    )}
    <p className="text-xs text-muted-foreground">Các khoản đối ứng chưa được cấn trừ. Chỉ giao dịch đã được người còn lại xác nhận mới giảm công nợ.</p>
    <Link href="/groups" className="block text-sm underline">← Nhóm của tôi</Link>
  </main>;
}
