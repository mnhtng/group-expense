import { requireUser } from "@/lib/auth/session";
import { getGroupDetails, getMemberRole, listMembers } from "@/lib/groups/service";
import { getExitEligibility } from "@/lib/groups/membership";
import { GroupMembershipManager } from "@/components/groups/group-membership-manager";
import { archiveGroupAction, createInviteAction, renameGroupAction } from "@/app/actions/groups";
import Link from "next/link";
import { notFound } from "next/navigation";

export default async function ManageGroupPage({ params, searchParams }: {
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
  const [members, eligibility] = await Promise.all([
    listMembers(groupId, user.id),
    getExitEligibility(groupId, user.id),
  ]);
  if (!eligibility) notFound();

  const inviteUrl = invite
    ? `${process.env.BETTER_AUTH_URL ?? "http://localhost:3000"}/invite/${invite}`
    : null;
  const canManage = role === "owner" || role === "admin";

  // A full settings page rather than a <details> disclosure:
  // Server Actions and router.refresh() must never collapse the controls.
  return <main className="app-page space-y-6">
    <Link href={`/groups/${groupId}`}
      className="-ml-2 inline-flex min-h-11 items-center rounded-xl px-2 text-sm font-medium text-muted-foreground">
      <span className="mr-2" aria-hidden="true">←</span> Quay lại nhóm
    </Link>
    <header className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Group Expense</p>
      <h1 className="text-2xl font-semibold">Quản lý nhóm</h1>
      <p className="break-words text-sm text-muted-foreground">{group.name} · {members.length} thành viên đang hoạt động</p>
    </header>

    {canManage && <section aria-labelledby="rename-group" className="space-y-4 rounded-3xl border bg-card p-5">
      <h2 id="rename-group" className="text-lg font-semibold">Thông tin nhóm</h2>
      <form action={renameGroupAction} className="grid gap-3">
        <input type="hidden" name="groupId" value={groupId}/>
        <label htmlFor="group-name" className="text-sm font-medium">Tên nhóm</label>
        <input id="group-name" aria-label="Đổi tên nhóm" name="name" required minLength={2} maxLength={120}
          defaultValue={group.name} className="min-w-0 rounded-2xl border bg-background px-4 py-3"/>
        <button type="submit" className="min-h-12 rounded-2xl bg-secondary px-5 py-3 text-sm font-semibold">
          Lưu tên nhóm
        </button>
      </form>
    </section>}

    <section aria-labelledby="members-heading" className="space-y-4">
      <h2 id="members-heading" className="text-lg font-semibold">Thành viên và quyền hạn</h2>
      <GroupMembershipManager groupId={groupId} userId={user.id} role={role}
        members={members} eligibility={eligibility}/>
    </section>

    {canManage && <section aria-labelledby="invite-heading" className="space-y-3 rounded-3xl border bg-card p-5">
      <h2 id="invite-heading" className="text-lg font-semibold">Mời thành viên</h2>
      <p className="text-sm text-muted-foreground">Tạo liên kết tham gia nhóm có hiệu lực trong 7 ngày.</p>
      <form action={createInviteAction}>
        <input type="hidden" name="groupId" value={groupId}/>
        <button type="submit" className="min-h-12 rounded-2xl bg-secondary px-5 py-3 text-sm font-semibold">
          Tạo link mời
        </button>
      </form>
      {inviteUrl && <div className="space-y-2 rounded-2xl border p-4 text-sm">
        <p className="font-medium">Link mời mới</p>
        <a className="block break-all underline underline-offset-4" href={inviteUrl}>
          {inviteUrl}
        </a>
      </div>}
    </section>}

    {role === "owner" && <section aria-labelledby="archive-heading"
      className="space-y-3 rounded-3xl border border-destructive/30 p-5">
      <h2 id="archive-heading" className="text-lg font-semibold">Lưu trữ nhóm</h2>
      <p className="text-sm text-muted-foreground">
        Chỉ có thể lưu trữ khi toàn bộ công nợ đã được giải quyết.
      </p>
      <form action={archiveGroupAction} className="space-y-3">
        <input type="hidden" name="groupId" value={groupId}/>
        <label htmlFor="archive-confirmation" className="block text-sm font-medium">Nhập đúng tên nhóm để xác nhận</label>
        <input id="archive-confirmation" name="confirmation" required placeholder="Tên nhóm"
          className="w-full rounded-2xl border bg-background px-4 py-3"/>
        <button type="submit" className="min-h-12 rounded-2xl border border-destructive px-5 py-3 text-sm font-medium text-destructive">
          Lưu trữ nhóm
        </button>
      </form>
    </section>}
    <p className="text-xs leading-relaxed text-muted-foreground">
      Khi thành viên rời nhóm, các khoản công nợ và hóa đơn đã phát sinh vẫn được lưu lại.
    </p>
  </main>;
}
