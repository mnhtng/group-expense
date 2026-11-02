import { requireUser } from "@/lib/auth/session";
import { getGroupDetails, getMemberRole, listMembers } from "@/lib/groups/service";
import { listExpenses } from "@/lib/expenses/service";
import { archiveGroupAction, createInviteAction, removeMemberAction, renameGroupAction } from "@/app/actions/groups";
import Link from "next/link";
import { notFound } from "next/navigation";

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
  const [members, expenses] = await Promise.all([
    listMembers(groupId, user.id), listExpenses(groupId, user.id)
  ]);
  const inviteUrl = invite ? `${process.env.BETTER_AUTH_URL ?? "http://localhost:3000"}/invite/${invite}` : null;
  return <main className="mx-auto min-h-dvh max-w-lg space-y-6 px-5 py-8">
    <Link href="/groups" className="text-sm text-muted-foreground">← Nhóm của tôi</Link>
    <div className="flex items-center justify-between gap-3">
      <div><h1 className="text-2xl font-semibold">{group.name}</h1>
        <p className="text-xs text-muted-foreground">Đơn vị tiền: {group.currency}</p></div>
      <Link href={`/groups/${groupId}/expenses/new`} className="rounded-xl bg-primary px-3 py-3 text-sm font-semibold text-primary-foreground">
        + Hóa đơn
      </Link>
    </div>
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">Hóa đơn ({expenses.length})</h2>
      {expenses.length === 0 && <p className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">
        Nhóm chưa có hóa đơn. Chọn + Hóa đơn để thêm từng món và phân chia chi phí.
      </p>}
      {expenses.map(e => <Link key={e.id} href={`/groups/${groupId}/expenses/${e.id}`}
        className="flex items-center justify-between gap-3 rounded-2xl border bg-card p-4">
        <div className="min-w-0"><h3 className="truncate font-semibold">{e.title}</h3>
          <p className="mt-1 text-xs text-muted-foreground">{e.occurredOn} · {e.itemCount} món · {e.payerName} đã trả</p></div>
        <strong className="shrink-0 text-sm tabular-nums">{vnd(e.totalMinor)}</strong>
      </Link>)}
    </section>
    <details className="rounded-2xl border p-4">
      <summary className="cursor-pointer font-semibold">Quản lý nhóm & thành viên ({members.length})</summary>
      <div className="mt-4 space-y-4">
        {["owner", "admin"].includes(role) && <form action={renameGroupAction} className="flex gap-2">
          <input type="hidden" name="groupId" value={groupId}/>
          <input aria-label="Đổi tên nhóm" required minLength={2} maxLength={120}
            name="name" defaultValue={group.name} className="min-w-0 flex-1 rounded-xl border bg-background p-3"/>
          <button className="rounded-xl bg-secondary px-3">Đổi tên</button>
        </form>}
        {members.map(member => <div key={member.id} className="flex items-center justify-between gap-2 text-sm">
          <span>{member.name} <small className="text-muted-foreground">({member.role})</small></span>
          {member.id !== user.id && member.role !== "owner" && ["owner", "admin"].includes(role) &&
            <form action={removeMemberAction}>
              <input type="hidden" name="groupId" value={groupId}/>
              <input type="hidden" name="memberId" value={member.id}/>
              <button className="text-destructive">Xóa</button>
            </form>}
        </div>)}
        {["owner","admin"].includes(role) && <form action={createInviteAction}>
          <input type="hidden" name="groupId" value={groupId}/>
          <button className="rounded-xl bg-secondary px-4 py-3 text-sm">Tạo link mời (7 ngày)</button>
        </form>}
        {inviteUrl && <div className="break-all rounded-xl border p-3 text-sm">
          Link mời: <a className="underline" href={inviteUrl}>{inviteUrl}</a>
        </div>}
        {role === "owner" && <form action={archiveGroupAction} className="space-y-2 border-t pt-4">
          <p className="text-sm font-semibold">Lưu trữ nhóm</p>
          <input type="hidden" name="groupId" value={groupId}/>
          <input name="confirmation" required placeholder="Nhập đúng tên nhóm"
            className="w-full rounded-xl border bg-background p-3"/>
          <button className="rounded-xl border border-destructive px-4 py-2 text-sm text-destructive">Lưu trữ nhóm</button>
        </form>}
      </div>
    </details>
    <p className="text-xs text-muted-foreground">Dữ liệu món và phần chia đã sẵn sàng. Sổ công nợ sẽ được triển khai trong Sprint 3.</p>
  </main>;
}
