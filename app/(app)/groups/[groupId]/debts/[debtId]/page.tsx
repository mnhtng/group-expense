import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { getDebtDetails } from "@/lib/debts/service";
import { SettlementRequestForm } from "@/components/settlements/settlement-request-form";

const vnd = (amount: string) => new Intl.NumberFormat("vi-VN").format(BigInt(amount)) + " ₫";
const shortDate = (date: string) => date.split("-").reverse().join("/");
const dateTime = (value: string) => new Intl.DateTimeFormat("vi-VN", {
  day: "2-digit", month: "2-digit", year: "numeric",
  hour: "2-digit", minute: "2-digit", timeZone: "Asia/Ho_Chi_Minh",
}).format(new Date(value));
const statusLabel = {
  pending: "Chờ xác nhận", confirmed: "Đã xác nhận",
  rejected: "Đã từ chối", cancelled: "Đã hủy",
} as const;

export default async function DebtDetailPage({ params }: {
  params: Promise<{ groupId: string; debtId: string }>
}) {
  const { groupId, debtId } = await params;
  const user = await requireUser();
  const detail = await getDebtDetails(groupId, debtId, user.id);
  if (!detail) notFound();
  const { debt, sources, payments } = detail;
  const isDebtor = debt.debtorId === user.id;
  const isCreditor = debt.creditorId === user.id;
  const amountColor = isDebtor ? "text-money-out" : isCreditor ? "text-money-in" : "text-foreground";
  const prefix = isDebtor ? "−" : isCreditor ? "+" : "";
  const outstanding = BigInt(debt.outstandingMinor);
  const paid = BigInt(debt.confirmedMinor);
  const pending = BigInt(debt.pendingMinor);
  const progress = BigInt(debt.amountMinor) > 0n
    ? Number(paid * 100n / BigInt(debt.amountMinor)) : 0;
  const status = outstanding === 0n ? "Đã tất toán"
    : pending > 0n ? "Đang chờ xác nhận"
    : paid > 0n ? "Đã thanh toán một phần" : "Chưa thanh toán";
  return <main className="app-page space-y-5">
    <Link href={`/groups/${groupId}/debts`} className="text-sm text-muted-foreground">
      ← Sổ công nợ {debt.groupName}
    </Link>
    <header className="space-y-4 rounded-2xl border bg-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm text-muted-foreground">
          {debt.groupName} · {shortDate(debt.occurredOn)}
        </span>
        <span className="rounded-full bg-secondary px-2.5 py-1 text-xs font-medium">{status}</span>
      </div>
      <div>
        <h1 className="text-xl font-semibold">{debt.debtorName} cần trả {debt.creditorName}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Hóa đơn: {debt.expenseTitle} · {sources.length} món liên quan
        </p>
      </div>
      <div>
        <p className="text-xs text-muted-foreground">
          {isDebtor ? "Bạn còn cần trả" : isCreditor ? "Bạn còn cần nhận" : "Công nợ còn lại"}
        </p>
        <strong className={`mt-1 block break-words text-3xl font-bold tabular-nums ${amountColor}`}>
          {prefix}{vnd(debt.outstandingMinor)}
        </strong>
      </div>
      <div>
        <div className="h-2.5 overflow-hidden rounded-full bg-secondary">
          <div className="h-full rounded-full bg-money-in" style={{ width: `${progress}%` }} />
        </div>
        <p className="mt-2 text-xs text-muted-foreground">{progress}% công nợ đã được xác nhận hoàn trả</p>
      </div>
      <dl className="grid grid-cols-2 gap-3 border-t pt-4 text-sm">
        <div><dt className="text-xs text-muted-foreground">Nợ gốc</dt>
          <dd className="mt-1 font-semibold tabular-nums">{vnd(debt.amountMinor)}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Đã hoàn trả</dt>
          <dd className="mt-1 font-semibold tabular-nums">{vnd(debt.confirmedMinor)}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Chờ xác nhận</dt>
          <dd className="mt-1 font-semibold tabular-nums">{vnd(debt.pendingMinor)}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Có thể thanh toán</dt>
          <dd className="mt-1 font-semibold tabular-nums">{vnd(debt.availableMinor)}</dd></div>
      </dl>
      <p className="border-t pt-3 text-xs text-muted-foreground">
        Tổng hóa đơn: {vnd(debt.expenseTotalMinor)} · Hóa đơn phiên bản {debt.expenseVersion}
      </p>
    </header>
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">Chi tiết các món ({sources.length})</h2>
        <span className="text-sm font-semibold tabular-nums">
          {vnd(sources.reduce((sum, item) => sum + BigInt(item.amountMinor), 0n).toString())}
        </span>
      </div>
      {sources.map(source => <div key={source.itemId}
        className="flex items-start justify-between gap-3 rounded-xl border bg-card p-4 text-sm">
        <span className="min-w-0 break-words">{source.itemName}</span>
        <strong className="shrink-0 tabular-nums">{vnd(source.amountMinor)}</strong>
      </div>)}
      <p className="text-xs text-muted-foreground">
        Đây là phần chi phí của {debt.debtorName} trong hóa đơn do {debt.creditorName} thanh toán.
      </p>
    </section>
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">Lịch sử hoàn trả ({payments.length})</h2>
      {payments.length === 0 &&
        <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
          Chưa có lần hoàn trả nào được ghi nhận.
        </p>}
      {payments.map(payment => <Link key={payment.id}
        href={`/groups/${groupId}/settlements/${payment.id}`}
        className="block space-y-2 rounded-2xl border bg-card p-4 transition-colors hover:bg-secondary/40">
        <div className="flex items-center justify-between gap-3">
          <strong className="text-sm">{statusLabel[payment.status]}</strong>
          <strong className={`shrink-0 font-semibold tabular-nums ${amountColor}`}>
            {prefix}{vnd(payment.amountMinor)}
          </strong>
        </div>
        <p className="text-xs text-muted-foreground">
          Tạo: {dateTime(payment.createdAt)} · {payment.initiatedBy === debt.debtorId ? debt.debtorName : debt.creditorName}
        </p>
        {payment.resolvedAt &&
          <p className="text-xs text-muted-foreground">
            Xử lý: {dateTime(payment.resolvedAt)}
            {payment.resolvedBy ? ` · ${payment.resolvedBy === debt.debtorId ? debt.debtorName : debt.creditorName}` : ""}
          </p>}
        {payment.note && <p className="break-words text-sm">{payment.note}</p>}
        <p className="text-xs text-muted-foreground">
          {payment.status === "confirmed" ? "Đã trừ khỏi công nợ"
            : payment.status === "pending" ? "Chưa trừ khỏi công nợ"
              : "Không làm thay đổi công nợ"}
        </p>
      </Link>)}
    </section>
    {[debt.debtorId, debt.creditorId].includes(user.id) &&
      <SettlementRequestForm groupId={groupId} debtId={debt.id}
        availableMinor={debt.availableMinor}
        direction={isDebtor ? "debtor" : "creditor"}/>}
    <Link href={`/groups/${groupId}/expenses/${debt.expenseId}`}
      className="block rounded-xl bg-secondary p-4 text-center text-sm font-medium">
      Xem hóa đơn gốc
    </Link>
  </main>;
}
