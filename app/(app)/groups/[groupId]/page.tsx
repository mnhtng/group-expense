import { requireUser } from "@/lib/auth/session";
import { getGroupDetails, getMemberRole, listMembers } from "@/lib/groups/service";
import { archiveGroupAction, createInviteAction, removeMemberAction, renameGroupAction } from "@/app/actions/groups";
import Link from "next/link";
import { notFound } from "next/navigation";

export default async function GroupPage({
  params, searchParams,
}: {
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
  const members = await listMembers(groupId, user.id);
  const inviteUrl = invite ? `${process.env.BETTER_AUTH_URL ?? "http://localhost:3000"}/invite/${invite}` : null;
  return (
    <main className="mx-auto min-h-dvh max-w-lg space-y-6 px-5 py-8">
      <Link href="/groups" className="text-sm text-muted-foreground">← Nhóm của tôi</Link>
      <h1 className="font-heading text-2xl font-semibold">{group.name}</h1>
      <p className="text-sm text-muted-foreground">Đơn vị tiền: {group.currency}</p>
      {["owner", "admin"].includes(role) && (
        <form action={renameGroupAction} className="flex gap-2">
          <input type="hidden" name="groupId" value={groupId} />
          <input aria-label="Đổi tên nhóm" name="name" defaultValue={group.name}
            required minLength={2} maxLength={120} className="min-w-0 flex-1 rounded-xl border bg-background px-3 py-2"/>
          <button className="rounded-xl bg-secondary px-4 py-2">Đổi tên</button>
        </form>
      )}
      <h2 className="text-lg font-semibold">Thành viên</h2>
      <div className="space-y-2">
        {members.map((member) => (
          <div key={member.id} className="flex items-center justify-between rounded-xl border p-3">
            <span>{member.name} <small className="text-muted-foreground">({member.role})</small></span>
            {member.id !== user.id && member.role !== "owner" && ["owner","admin"].includes(role) &&
              <form action={removeMemberAction}>
                <input type="hidden" name="groupId" value={groupId} />
                <input type="hidden" name="memberId" value={member.id} />
                <button className="text-sm text-destructive">Xóa</button>
              </form>}
          </div>
        ))}
      </div>
      {["owner", "admin"].includes(role) && (
        <form action={createInviteAction}>
          <input type="hidden" name="groupId" value={groupId}/>
          <button className="rounded-xl bg-primary px-4 py-3 text-primary-foreground">Tạo link mời (7 ngày)</button>
        </form>
      )}
      {inviteUrl && <div className="break-all rounded-xl border p-4 text-sm">
        Liên kết mời mới: <a className="underline" href={inviteUrl}>{inviteUrl}</a>
      </div>}
      {role === "owner" && (
        <form action={archiveGroupAction} className="space-y-2 rounded-xl border p-4">
          <input type="hidden" name="groupId" value={groupId}/>
          <p className="text-sm font-medium">Lưu trữ nhóm</p>
          <p className="text-xs text-muted-foreground">Nhập chính xác tên nhóm để xác nhận lưu trữ. Nhóm sẽ biến mất khỏi danh sách, dữ liệu không bị xóa.</p>
          <input name="confirmation" required autoComplete="off" placeholder={group.name}
            aria-label="Nhập lại tên nhóm để xác nhận" className="w-full rounded-xl border bg-background px-3 py-2"/>
          <button className="rounded-xl border px-4 py-2 text-sm text-destructive">Lưu trữ nhóm</button>
        </form>
      )}
      <p className="text-sm text-muted-foreground">Chi tiêu và công nợ sẽ được triển khai trong Sprint 2–4.</p>
    </main>
  );
}
