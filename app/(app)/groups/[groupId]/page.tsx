import { requireUser } from "@/lib/auth/session";
import { getMemberRole, listMembers } from "@/lib/groups/service";
import { createInviteAction, removeMemberAction } from "@/app/actions/groups";
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
  const members = await listMembers(groupId, user.id);
  const inviteUrl = invite ? `${process.env.BETTER_AUTH_URL ?? "http://localhost:3000"}/invite/${invite}` : null;
  return (
    <main className="mx-auto min-h-dvh max-w-lg space-y-6 px-5 py-8">
      <Link href="/groups" className="text-sm text-muted-foreground">← Nhóm của tôi</Link>
      <h1 className="font-heading text-2xl font-semibold">Thành viên nhóm</h1>
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
      <p className="text-sm text-muted-foreground">Chi tiêu và công nợ sẽ được triển khai trong Sprint 2–4.</p>
    </main>
  );
}
