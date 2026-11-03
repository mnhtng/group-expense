import { requireUser } from "@/lib/auth/session";
import { getGroupDetails, getMemberRole, listMembers } from "@/lib/groups/service";
import { listExpenses } from "@/lib/expenses/service";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

const vnd = (minor: string) => new Intl.NumberFormat("vi-VN").format(BigInt(minor)) + " ₫";

export default async function GroupPage({ params, searchParams }: {
  params: Promise<{ groupId: string }>;
  searchParams: Promise<{ invite?: string }>;
}) {
  const { groupId } = await params;
  const { invite } = await searchParams;
  const user = await requireUser();
  const role = await getMemberRole(groupId, user.id);
  if (!role) notFound();
  const group = await getGroupDetails(groupId, user.id);
  if (!group) notFound();
  // Preserve links issued before group management moved to its own page.
  if (invite) redirect(`/groups/${groupId}/manage?invite=${encodeURIComponent(invite)}`);
  const [members, expenses] = await Promise.all([
    listMembers(groupId, user.id), listExpenses(groupId, user.id),
  ]);
  return <main className="app-page space-y-6">
    <Link href="/groups" className="-ml-2 inline-flex min-h-11 items-center rounded-xl px-2 text-sm font-medium text-muted-foreground">
      <span aria-hidden="true" className="mr-2">←</span> Nhóm của tôi
    </Link>
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div className="min-w-0 flex-1"><h1 className="break-words text-2xl font-semibold">{group.name}</h1>
        <p className="text-xs text-muted-foreground">{group.currency}</p>
        {group.notes&&<p className="mt-2 whitespace-pre-wrap break-words text-sm text-muted-foreground">{group.notes}</p>}</div>
      <Link href={`/groups/${groupId}/expenses/new`} className="inline-flex min-h-12 shrink-0 items-center justify-center rounded-2xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground">
        + Hóa đơn
      </Link>
    </div>
    <Link href={`/groups/${groupId}/debts`}
      className="flex min-h-[88px] items-center justify-between gap-4 rounded-3xl border bg-secondary p-5">
      <span><strong className="block">Công nợ</strong>
</span>
      <span aria-hidden="true">→</span>
    </Link>
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">Hóa đơn ({expenses.length})</h2>
      {expenses.length === 0 && <p className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">
        Chưa có hóa đơn.
      </p>}
      {expenses.map(e => <Link key={e.id} href={`/groups/${groupId}/expenses/${e.id}`}
        className="flex min-h-[80px] items-center justify-between gap-3 rounded-3xl border bg-card p-4 sm:p-5">
        <div className="min-w-0"><h3 className="truncate font-semibold">{e.title}</h3>
          <p className="mt-1 text-xs text-muted-foreground">{e.occurredOn} · {e.itemCount} món · {e.payerName} đã trả</p></div>
        <strong className="shrink-0 text-sm tabular-nums text-money-out">−{vnd(e.totalMinor)}</strong>
      </Link>)}
    </section>
    <Link href={`/groups/${groupId}/manage`}
      className="flex min-h-[88px] items-center justify-between gap-4 rounded-3xl border bg-card p-5 transition-colors hover:bg-secondary/40 active:bg-secondary/70">
      <span className="min-w-0">
        <strong className="block text-base">Quản lý nhóm</strong>
        <span className="mt-1 block text-sm text-muted-foreground">
          {members.length} thành viên
        </span>
      </span>
      <span aria-hidden="true" className="shrink-0 text-xl text-muted-foreground">→</span>
    </Link>
  </main>;
}
