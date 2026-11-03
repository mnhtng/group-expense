import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { getDebtDetails } from "@/lib/debts/service";
import { SettlementRequestForm } from "@/components/settlements/settlement-request-form";

const vnd = (amount: string) => new Intl.NumberFormat("vi-VN").format(BigInt(amount)) + " ₫";

export default async function DebtDetailPage({ params }: {
  params: Promise<{ groupId: string; debtId: string }>
}) {
  const { groupId, debtId } = await params;
  const user = await requireUser();
  const detail = await getDebtDetails(groupId, debtId, user.id);
  if (!detail) notFound();
  const { debt, sources } = detail;
  return <main className="app-page space-y-5">
    <Link href={`/groups/${groupId}/debts`} className="text-sm text-muted-foreground">← Sổ công nợ {debt.groupName}</Link>
    <header className="rounded-2xl border bg-card p-5">
      <p className="text-sm text-muted-foreground">{debt.occurredOn}</p>
      <h1 className="mt-2 text-xl font-semibold">{debt.debtorName} cần trả {debt.creditorName}</h1>
      <strong className="mt-3 block text-3xl tabular-nums">{vnd(debt.outstandingMinor)}</strong>
      <p className="mt-2 text-sm text-muted-foreground">
        Gốc: {vnd(debt.amountMinor)} · Đã xác nhận: {vnd(debt.confirmedMinor)}
      </p>
      <p className="mt-1 text-sm text-muted-foreground">
        Chờ xác nhận: {vnd(debt.pendingMinor)} · Có thể thanh toán: {vnd(debt.availableMinor)}
      </p>
      <p className="mt-3 text-sm text-muted-foreground">Hóa đơn: {debt.expenseTitle}</p>
    </header>
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">Các món</h2>
      {sources.map(source => <div key={source.itemId}
        className="flex justify-between gap-3 rounded-xl border p-4 text-sm">
        <span>{source.itemName}</span>
        <strong className="tabular-nums">{vnd(source.amountMinor)}</strong>
      </div>)}
    </section>
    {[debt.debtorId,debt.creditorId].includes(user.id)&&
      <SettlementRequestForm groupId={groupId} debtId={debt.id}
        availableMinor={debt.availableMinor}
        direction={user.id===debt.debtorId?"debtor":"creditor"}/>}
    <Link href={`/groups/${groupId}/settlements`} className="block text-sm underline">
      Lịch sử thanh toán
    </Link>
    <Link href={`/groups/${groupId}/expenses/${debt.expenseId}`}
      className="block rounded-xl bg-secondary p-3 text-center text-sm font-medium">
      Xem hóa đơn gốc
    </Link>
  </main>;
}
