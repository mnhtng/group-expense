import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { getDebtDetails } from "@/lib/debts/service";

const vnd = (amount: string) => new Intl.NumberFormat("vi-VN").format(BigInt(amount)) + " ₫";

export default async function DebtDetailPage({ params }: {
  params: Promise<{ groupId: string; debtId: string }>
}) {
  const { groupId, debtId } = await params;
  const user = await requireUser();
  const detail = await getDebtDetails(groupId, debtId, user.id);
  if (!detail) notFound();
  const { debt, sources } = detail;
  return <main className="mx-auto min-h-dvh max-w-lg space-y-5 px-5 py-8">
    <Link href={`/groups/${groupId}/debts`} className="text-sm text-muted-foreground">← Sổ công nợ {debt.groupName}</Link>
    <header className="rounded-2xl border bg-card p-5">
      <p className="text-sm text-muted-foreground">Công nợ gốc · {debt.occurredOn}</p>
      <h1 className="mt-2 text-xl font-semibold">{debt.debtorName} cần trả {debt.creditorName}</h1>
      <strong className="mt-3 block text-3xl tabular-nums">{vnd(debt.amountMinor)}</strong>
      <p className="mt-3 text-sm text-muted-foreground">Hóa đơn: {debt.expenseTitle} · phiên bản {debt.expenseVersion}</p>
    </header>
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">Phát sinh từ các món</h2>
      {sources.map(source => <div key={source.itemId}
        className="flex justify-between gap-3 rounded-xl border p-4 text-sm">
        <span>{source.itemName}</span>
        <strong className="tabular-nums">{vnd(source.amountMinor)}</strong>
      </div>)}
    </section>
    <Link href={`/groups/${groupId}/expenses/${debt.expenseId}`}
      className="block rounded-xl bg-secondary p-3 text-center text-sm font-medium">
      Xem hóa đơn gốc
    </Link>
    <p className="text-xs text-muted-foreground">Chưa ghi nhận thanh toán. Số dư sẽ được cập nhật theo xác nhận hai bên ở Sprint 4.</p>
  </main>;
}
