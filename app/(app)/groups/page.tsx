import { listGroups } from "@/lib/groups/service";
import { requireUser } from "@/lib/auth/session";
import { createGroupAction } from "@/app/actions/groups";
import Link from "next/link";

export default async function GroupsPage() {
  const user = await requireUser();
  const groups = await listGroups(user.id);
  return (
    <main className="mx-auto min-h-dvh max-w-lg space-y-6 px-5 py-8">
      <header>
        <p className="text-sm text-muted-foreground">Group Expense</p>
        <h1 className="font-heading text-2xl font-semibold">Nhóm của tôi</h1>
        <p className="mt-1 text-sm text-muted-foreground">Xin chào {user.name}</p>
      </header>
      <form action={createGroupAction} className="flex gap-2">
        <input name="name" minLength={2} maxLength={120} required placeholder="Tên nhóm mới"
          className="min-w-0 flex-1 rounded-xl border bg-background px-4 py-3" />
        <button className="rounded-xl bg-primary px-4 py-3 text-primary-foreground">Tạo nhóm</button>
      </form>
      <div className="space-y-3">
        {groups.length === 0 && <p className="rounded-2xl border p-6 text-muted-foreground">Chưa có nhóm nào.</p>}
        {groups.map((group) => (
          <Link key={group.id} href={`/groups/${group.id}`} className="block rounded-2xl border p-5">
            <h2 className="font-semibold">{group.name}</h2>
            <p className="text-sm text-muted-foreground">{group.currency} · {group.role}</p>
          </Link>
        ))}
      </div>
      <nav className="flex justify-between border-t pt-4 text-sm">
        <Link href="/groups">Nhóm</Link><Link href="/debts">Công nợ</Link>
        <Link href="/activity">Hoạt động</Link><Link href="/settings">Cá nhân</Link>
      </nav>
    </main>
  );
}
