import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { listPersonalDebts, listPersonalDebtItems, sumDebtAmounts } from "@/lib/debts/service";
import { listPersonalSettlements } from "@/lib/settlements/service";
import { DebtCard } from "@/components/debts/debt-card";

const vnd = (amount: string) => new Intl.NumberFormat("vi-VN").format(BigInt(amount)) + " ₫";

export default async function DebtsPage() {
  const user = await requireUser();
  const [debts, items, settlements] = await Promise.all([
    listPersonalDebts(user.id),
    listPersonalDebtItems(user.id),
    listPersonalSettlements(user.id),
  ]);
  const payable = debts.filter(d => d.direction === "pay");
  const receivable = debts.filter(d => d.direction === "receive");
  const incomingItems = items.filter(d => d.creditorId === user.id);
  const outgoingItems = items.filter(d => d.debtorId === user.id);
  return <main className="app-page space-y-6">
    <header>
      <h1 className="text-2xl font-semibold">Công nợ của tôi</h1>
      <p className="mt-1 text-sm text-muted-foreground">Theo từng hóa đơn, trên tất cả nhóm</p>
    </header>
    <div className="grid grid-cols-2 gap-3">
      <div className="min-w-0 rounded-2xl border bg-card p-4">
        <p className="text-xs text-muted-foreground">Tôi cần trả</p>
        <p className="mt-2 break-words text-lg font-bold tabular-nums text-money-out">
          −{vnd(sumDebtAmounts(payable))}
        </p>
      </div>
      <div className="min-w-0 rounded-2xl border bg-card p-4">
        <p className="text-xs text-muted-foreground">Tôi cần nhận</p>
        <p className="mt-2 break-words text-lg font-bold tabular-nums text-money-in">
          +{vnd(sumDebtAmounts(receivable))}
        </p>
      </div>
    </div>
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">Chờ xác nhận ({settlements.length})</h2>
      {settlements.length === 0 &&
        <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
          Không có yêu cầu chờ.
        </p>}
      {settlements.map(s => {
        const outgoing = s.debtorId === user.id;
        return <Link key={s.id} href={`/groups/${s.groupId}/settlements/${s.id}`}
          className="block space-y-2 rounded-2xl border bg-card p-4 transition-colors hover:bg-secondary/40">
          <div className="flex items-center justify-between gap-3 text-sm">
            <strong>{s.initiatedBy === user.id ? "Bạn đã yêu cầu" : "Cần bạn xác nhận"}</strong>
            <strong className={`shrink-0 tabular-nums ${outgoing ? "text-money-out" : "text-money-in"}`}>
              {outgoing ? "−" : "+"}{vnd(s.amountMinor)}
            </strong>
          </div>
          <p className="text-xs text-muted-foreground">
            {s.debtorName} trả {s.creditorName} · {s.groupName}
          </p>
          <p className="text-xs text-muted-foreground">Đang chờ · Chưa trừ công nợ</p>
        </Link>;
      })}
    </section>
    {([
      ["Tôi cần trả", outgoingItems],
      ["Tôi cần nhận", incomingItems],
    ] as const).map(([heading, rows]) =>
      <section key={heading} className="space-y-3">
        <h2 className="text-lg font-semibold">{heading} ({rows.length} khoản)</h2>
        {rows.length === 0 &&
          <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
            Không có khoản nợ nào.
          </p>}
        {rows.map(debt => <DebtCard key={debt.id} debt={debt} viewerId={user.id} showGroup />)}
      </section>
    )}
    {items.length === 250 && <p className="text-xs text-muted-foreground">
      Đang hiển thị tối đa 250 khoản gần nhất. Tổng công nợ phía trên được tính từ toàn bộ khoản còn nợ.
    </p>}
  </main>;
}
