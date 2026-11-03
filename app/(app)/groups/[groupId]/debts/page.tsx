import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { getGroupDetails } from "@/lib/groups/service";
import { listGroupDebts, sumDebtAmounts } from "@/lib/debts/service";
import { DebtCard } from "@/components/debts/debt-card";

const vnd = (amount: string) => new Intl.NumberFormat("vi-VN").format(BigInt(amount)) + " ₫";
const sumOutstanding = (debts: { outstandingMinor: string }[]) =>
  sumDebtAmounts(debts.map(debt => ({ amountMinor: debt.outstandingMinor })));

export default async function GroupDebtsPage({ params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;
  const user = await requireUser();
  const [group, debts] = await Promise.all([
    getGroupDetails(groupId, user.id), listGroupDebts(groupId, user.id),
  ]);
  if (!group || !debts) notFound();
  const myPayable = debts.filter(debt => debt.debtorId === user.id);
  const myReceivable = debts.filter(debt => debt.creditorId === user.id);
  const open = debts.filter(debt => BigInt(debt.outstandingMinor) > 0n);
  return <main className="app-page space-y-5">
    <Link href={`/groups/${groupId}`} className="text-sm text-muted-foreground">
      ← {group.name}
    </Link>
    <header>
      <h1 className="text-2xl font-semibold">Sổ công nợ</h1>
      <p className="mt-1 text-sm text-muted-foreground">{debts.length} khoản · Chi tiết theo hóa đơn</p>
    </header>
    <div className="grid grid-cols-2 gap-3">
      <div className="min-w-0 rounded-2xl border bg-card p-4">
        <p className="text-xs text-muted-foreground">Tôi cần trả</p>
        <p className="mt-2 break-words text-lg font-bold tabular-nums text-money-out">
          −{vnd(sumOutstanding(myPayable))}
        </p>
      </div>
      <div className="min-w-0 rounded-2xl border bg-card p-4">
        <p className="text-xs text-muted-foreground">Tôi cần nhận</p>
        <p className="mt-2 break-words text-lg font-bold tabular-nums text-money-in">
          +{vnd(sumOutstanding(myReceivable))}
        </p>
      </div>
    </div>
    <div className="rounded-2xl border bg-secondary/50 p-4">
      <p className="text-xs text-muted-foreground">Tổng công nợ còn lại trong nhóm (mọi thành viên)</p>
      <p className="mt-1 text-lg font-bold tabular-nums">{vnd(sumOutstanding(debts))}</p>
    </div>
    <div className="grid grid-cols-2 gap-3">
      <Link href={`/groups/${groupId}/settlements/new`}
        className="flex min-h-12 items-center justify-center rounded-2xl bg-primary p-3 text-center text-sm font-semibold text-primary-foreground">
        + Ghi nhận thanh toán
      </Link>
      <Link href={`/groups/${groupId}/settlements`}
        className="flex min-h-12 items-center justify-center rounded-2xl border p-3 text-center text-sm font-semibold">
        Lịch sử thanh toán
      </Link>
    </div>
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">Các khoản còn nợ ({open.length})</h2>
      {open.length === 0 &&
        <p className="rounded-xl border border-dashed p-5 text-sm text-muted-foreground">
          Không còn công nợ.
        </p>}
      {open.map(debt => <DebtCard key={debt.id} debt={debt} viewerId={user.id} />)}
    </section>
    {debts.length !== open.length && <section className="space-y-3">
      <h2 className="text-lg font-semibold">Đã tất toán ({debts.length - open.length})</h2>
      {debts.filter(debt => BigInt(debt.outstandingMinor) === 0n).map(debt =>
        <DebtCard key={debt.id} debt={debt} viewerId={user.id} />)}
    </section>}
  </main>;
}
