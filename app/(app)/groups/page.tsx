import { listGroups } from "@/lib/groups/service";
import { requireUser } from "@/lib/auth/session";
import { CreateGroupForm } from "@/components/groups/create-group-form";
import Link from "next/link";

const roleLabels: Record<string, string> = {
  owner:"Chủ nhóm",
  admin:"Quản trị viên",
  member:"Thành viên",
};

export default async function GroupsPage() {
  const user = await requireUser();
  const groups = await listGroups(user.id);
  return <main className="app-page space-y-6">
    <header className="space-y-2">
      <h1 className="font-heading text-[clamp(1.75rem,7vw,2.125rem)] font-semibold leading-tight tracking-tight">
        Nhóm của tôi
      </h1>
    </header>

    <section aria-labelledby="new-group-heading" className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 id="new-group-heading" className="text-base font-semibold">Tạo nhóm mới</h2>
      </div>
      <CreateGroupForm/>
    </section>

    <section aria-labelledby="my-groups-heading" className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 id="my-groups-heading" className="text-base font-semibold">Nhóm của bạn</h2>
        <span className="rounded-full bg-secondary px-2.5 py-1 text-xs font-semibold tabular-nums"
          aria-label={`${groups.length} nhóm`}>{groups.length}</span>
      </div>
      {groups.length===0 &&
        <div className="rounded-3xl border border-dashed bg-card px-5 py-8 text-center">
          <p className="font-medium">Bạn chưa có nhóm nào</p>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Tạo nhóm để bắt đầu chia chi phí.
          </p>
        </div>}
      <div className="space-y-3">
        {groups.map(group=><Link key={group.id} href={`/groups/${group.id}`}
          className="group flex min-h-[96px] items-center gap-4 rounded-3xl border bg-card
            p-4 shadow-[0_2px_12px_rgba(0,0,0,0.025)] transition-colors
            hover:bg-secondary/40 active:bg-secondary/70 sm:p-5">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl
            bg-secondary text-lg font-bold" aria-hidden="true">
            {group.name.trim().charAt(0).toLocaleUpperCase("vi-VN")}
          </span>
          <span className="min-w-0 flex-1 space-y-1">
            <span className="block truncate text-base font-semibold">{group.name}</span>
            <span className="block text-sm text-muted-foreground">
              {group.currency} · {roleLabels[group.role]??group.role}
            </span>
          </span>
          <svg viewBox="0 0 24 24" className="size-5 shrink-0 text-muted-foreground/70"
            fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"
            strokeLinejoin="round" aria-hidden="true">
            <path d="m9 5 7 7-7 7"/>
          </svg>
        </Link>)}
      </div>
    </section>
  </main>;
}
