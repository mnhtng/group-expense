import { requireUser } from "@/lib/auth/session";
import { getGroupDetails, getMemberRole, listMembers } from "@/lib/groups/service";
import { getExitEligibility } from "@/lib/groups/membership";
import { GroupMembershipManager } from "@/components/groups/group-membership-manager";
import { GroupRenameForm } from "@/components/groups/group-rename-form";
import { GroupArchiveForm } from "@/components/groups/group-archive-form";
import { GroupInviteForm } from "@/components/groups/group-invite-form";
import { SettlementCycleSettingsPanel } from "@/components/groups/settlement-cycle-settings-panel";
import { getSettlementSettings } from "@/lib/settlement-cycles/settings";
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
  const [members, eligibility, settlementSettings] = await Promise.all([
    listMembers(groupId, user.id),
    getExitEligibility(groupId, user.id),
    getSettlementSettings(groupId, user.id),
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
      <h1 className="text-2xl font-semibold">Quản lý nhóm</h1>
      <p className="break-words text-sm text-muted-foreground">{group.name} · {members.length} thành viên</p>
    </header>

    {canManage && <section aria-labelledby="rename-group" className="space-y-4 rounded-3xl border bg-card p-5">
      <h2 id="rename-group" className="text-lg font-semibold">Thông tin nhóm</h2>
      <GroupRenameForm groupId={groupId} initialName={group.name}/>
    </section>}

    <section aria-labelledby="members-heading" className="space-y-4">
      <h2 id="members-heading" className="text-lg font-semibold">Thành viên và quyền hạn</h2>
      <GroupMembershipManager groupId={groupId} userId={user.id} role={role}
        members={members} eligibility={eligibility}/>
    </section>

    {settlementSettings.canManage && <SettlementCycleSettingsPanel
      key={`${settlementSettings.version}-${settlementSettings.managerIds.join(",")}`}
      groupId={groupId} initial={settlementSettings} members={members}/>}

    {canManage && <section aria-labelledby="invite-heading" className="space-y-3 rounded-3xl border bg-card p-5">
      <h2 id="invite-heading" className="text-lg font-semibold">Mời thành viên</h2>
      <p className="text-sm text-muted-foreground">Link mời có hiệu lực 7 ngày.</p>
      <GroupInviteForm groupId={groupId} groupName={group.name} initialInviteUrl={inviteUrl ?? undefined}/>
    </section>}

    {role === "owner" && <section aria-labelledby="archive-heading"
      className="space-y-3 rounded-3xl border border-destructive/30 p-5">
      <h2 id="archive-heading" className="text-lg font-semibold">Lưu trữ nhóm</h2>
      <p className="text-sm text-muted-foreground">
        Cần tất toán công nợ trước.
      </p>
      <GroupArchiveForm groupId={groupId} groupName={group.name}/>
    </section>}
  </main>;
}
