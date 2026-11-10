import {listGroups} from "@/lib/groups/service";
import {requireUser} from "@/lib/auth/session";
import {ActionLink,AppIcon,EmptyState,GroupedList,PageHeader} from "@/components/ui/app-screen";
import Link from "next/link";

export default async function GroupsPage(){
  const user=await requireUser();
  const groups=await listGroups(user.id);
  return <main className="app-page space-y-6">
    <PageHeader title="Nhóm của tôi" action={<ActionLink href="/groups/new"><AppIcon name="add"/>Tạo nhóm</ActionLink>}/>
    {groups.length===0?<EmptyState>Bạn chưa có nhóm nào.</EmptyState>:
      <GroupedList label="Nhóm của bạn">
        {groups.map(group=><Link key={group.id} href={`/groups/${group.id}`} className="app-list-row">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-secondary text-xl font-semibold" aria-hidden="true">
            {group.name.trim().charAt(0).toLocaleUpperCase("vi-VN")}
          </span>
          <span className="min-w-0 flex-1"><strong className="block truncate text-lg">{group.name}</strong>
            <span className="app-caption">{group.role==="owner"?"Chủ nhóm":group.role==="admin"?"Quản trị viên":"Thành viên"}</span>
          </span><AppIcon name="next" className="text-muted-foreground"/>
        </Link>)}
      </GroupedList>}
  </main>;
}
