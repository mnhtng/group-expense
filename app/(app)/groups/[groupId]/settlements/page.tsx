import Link from "next/link";
import { formatDateTimeDMY } from "@/lib/date-format";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { getGroupDetails } from "@/lib/groups/service";
import { listGroupSettlements } from "@/lib/settlements/service";

const vnd = (n: string) => new Intl.NumberFormat("vi-VN").format(BigInt(n)) + " ₫";
const labels = { pending: "Chờ xác nhận", confirmed: "Đã xác nhận",
  rejected: "Đã từ chối", cancelled: "Đã hủy" } as const;

export default async function SettlementsPage({ params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;
  const user = await requireUser();
  const [group, settlements] = await Promise.all([
    getGroupDetails(groupId, user.id), listGroupSettlements(groupId, user.id),
  ]);
  if (!group || !settlements) notFound();
  return <main className="app-page space-y-4">
    <Link href={`/groups/${groupId}/debts`} className="text-sm text-muted-foreground">
      ← Sổ công nợ {group.name}
    </Link>
    <h1 className="text-2xl font-semibold">Lịch sử thanh toán</h1>
    <p className="text-sm text-muted-foreground">{settlements.length} giao dịch</p>
    {settlements.length === 0 &&
      <p className="rounded-xl border p-5 text-sm text-muted-foreground">Chưa có giao dịch.</p>}
    {settlements.map(x => {
      const outgoing = x.debtorId === user.id;
      const incoming = x.creditorId === user.id;
      const color = outgoing ? "text-money-out" : incoming ? "text-money-in" : "text-foreground";
      return <Link key={x.id} href={`/groups/${groupId}/settlements/${x.id}`}
        className="block space-y-2 rounded-2xl border bg-card p-4 transition-colors hover:bg-secondary/40">
        <div className="flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
          <span>{labels[x.status]}</span>
          <span>{formatDateTimeDMY(x.createdAt)}</span>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-sm font-medium">{x.debtorName} trả {x.creditorName}</span>
          <strong className={`text-lg font-bold tabular-nums ${color}`}>
            {outgoing ? "−" : incoming ? "+" : ""}{vnd(x.amountMinor)}
          </strong>
        </div>
        {x.note && <p className="line-clamp-2 text-xs text-muted-foreground">{x.note}</p>}
        <p className="text-xs text-muted-foreground">
          {x.status === "pending" ? "Chưa trừ công nợ" :
            x.status === "confirmed" ? "Đã tính vào công nợ" : "Không tính vào công nợ"}
        </p>
      </Link>;
    })}
  </main>;
}
