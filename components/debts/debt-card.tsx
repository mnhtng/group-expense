import Link from "next/link";
import { formatDateDMY } from "@/lib/date-format";
import type { DebtRow } from "@/lib/debts/service";

const vnd = (amount: string) =>
  new Intl.NumberFormat("vi-VN").format(BigInt(amount)) + " ₫";

export function DebtCard({
  debt, viewerId, showGroup = false,
}: {
  debt: DebtRow;
  viewerId: string;
  showGroup?: boolean;
}) {
  const outgoing = debt.debtorId === viewerId;
  const incoming = debt.creditorId === viewerId;
  const color = outgoing ? "text-money-out" : incoming ? "text-money-in" : "text-foreground";
  const prefix = outgoing ? "−" : incoming ? "+" : "";
  const outstanding = BigInt(debt.outstandingMinor);
  const pending = BigInt(debt.pendingMinor);
  const confirmed = BigInt(debt.confirmedMinor);
  const state = outstanding === 0n ? "Đã tất toán"
    : pending > 0n ? "Chờ xác nhận"
    : confirmed > 0n ? "Đã xử lý một phần"
    : "Chưa thanh toán";
  const relation = outgoing
    ? `Bạn cần trả ${debt.creditorName}`
    : incoming
      ? `${debt.debtorName} cần trả bạn`
      : `${debt.debtorName} trả ${debt.creditorName}`;
  return <Link
    href={`/groups/${debt.groupId}/debts/${debt.id}`}
    className="block space-y-3 rounded-2xl border bg-card p-4 transition-colors hover:bg-secondary/40 active:bg-secondary/70"
    aria-label={`${relation}, ${debt.expenseTitle}, còn nợ ${vnd(debt.outstandingMinor)}. Xem chi tiết.`}
  >
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="min-w-0 flex-1">
        <p className="font-semibold break-words">{debt.expenseTitle}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {showGroup ? `${debt.groupName} · ` : ""}{formatDateDMY(debt.occurredOn)} · {debt.sourceCount} món liên quan
        </p>
      </div>
      <span className="shrink-0 rounded-full bg-secondary px-2.5 py-1 text-xs font-medium">
        {state}
      </span>
    </div>
    <div className="flex flex-wrap items-end justify-between gap-2">
      <p className="text-sm text-muted-foreground">{relation}</p>
      <strong className={`text-xl font-bold tabular-nums ${color}`}>
        {prefix}{vnd(debt.outstandingMinor)}
      </strong>
    </div>
    {debt.sourcePreview && <p className="line-clamp-2 text-xs text-muted-foreground">
      Món: {debt.sourcePreview}
    </p>}
    <dl className="grid grid-cols-2 gap-x-3 gap-y-2 border-t pt-3 text-xs">
      <div>
        <dt className="text-muted-foreground">Nợ gốc</dt>
        <dd className="mt-1 font-semibold tabular-nums">{vnd(debt.amountMinor)}</dd>
      </div>
      <div>
        <dt className="text-muted-foreground">Đã xử lý (tiền + bù trừ)</dt>
        <dd className="mt-1 font-semibold tabular-nums">{vnd(debt.confirmedMinor)}</dd>
      </div>
      {BigInt(debt.confirmedSetoffMinor)>0n && <div>
        <dt className="text-muted-foreground">Bù trừ phi tiền mặt</dt>
        <dd className="mt-1 font-semibold tabular-nums">{vnd(debt.confirmedSetoffMinor)}</dd>
      </div>}
      <div>
        <dt className="text-muted-foreground">Chờ xác nhận</dt>
        <dd className="mt-1 font-semibold tabular-nums">{vnd(debt.pendingMinor)}</dd>
      </div>
      <div>
        <dt className="text-muted-foreground">Còn có thể thanh toán</dt>
        <dd className="mt-1 font-semibold tabular-nums">{vnd(debt.availableMinor)}</dd>
      </div>
    </dl>
    <div className="flex items-center justify-between border-t pt-2 text-xs text-muted-foreground">
      <span>Tổng hóa đơn: {vnd(debt.expenseTotalMinor)}</span>
      <span className="font-medium text-foreground">Chi tiết →</span>
    </div>
  </Link>;
}
