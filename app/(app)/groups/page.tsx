import { listGroups } from "@/lib/groups/service";
import { requireUser } from "@/lib/auth/session";
import { createGroupAction } from "@/app/actions/groups";
import Link from "next/link";

const roleLabels: Record<string, string> = {
  owner:"Chủ nhóm",
  admin:"Quản trị viên",
  member:"Thành viên",
};

export default async function GroupsPage() {
  const user = await requireUser();
  const groups = await listGroups(user.id);
  return <main className="app-page space-y-8">
    <header className="space-y-2">
      <p className="text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">Group Expense</p>
      <h1 className="font-heading text-[clamp(1.75rem,7vw,2.125rem)] font-semibold leading-tight tracking-tight">
        Nhóm của tôi
      </h1>
      <p className="text-sm text-muted-foreground">Xin chào, {user.name}</p>
    </header>

    <section aria-labelledby="new-group-heading" className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 id="new-group-heading" className="text-base font-semibold">Tạo nhóm mới</h2>
      </div>
      <form action={createGroupAction} className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
        <label className="sr-only" htmlFor="new-group-name">Tên nhóm mới</label>
        <input id="new-group-name" name="name" minLength={2} maxLength={120}
          autoComplete="off" required placeholder="Nhập tên nhóm..."
          className="h-14 w-full min-w-0 rounded-2xl border bg-card px-4 text-base
            shadow-sm outline-none placeholder:text-muted-foreground/70
            focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/15"/>
        <button type="submit"
          className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl
            bg-primary px-6 text-base font-semibold text-primary-foreground
            transition-opacity active:opacity-85 sm:w-auto">
          <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M12 5v14M5 12h14"/>
          </svg>
          Tạo nhóm
        </button>
      </form>
    </section>

    <section aria-labelledby="my-groups-heading" className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 id="my-groups-heading" className="text-base font-semibold">Nhóm đang tham gia</h2>
        <span className="rounded-full bg-secondary px-2.5 py-1 text-xs font-semibold tabular-nums"
          aria-label={`${groups.length} nhóm`}>{groups.length}</span>
      </div>
      {groups.length===0 &&
        <div className="rounded-3xl border border-dashed bg-card px-5 py-8 text-center">
          <p className="font-medium">Bạn chưa có nhóm nào</p>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Tạo nhóm đầu tiên để chia tiền và theo dõi công nợ với mọi người.
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
