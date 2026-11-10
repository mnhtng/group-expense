import {notFound} from "next/navigation";
import {requireUser} from "@/lib/auth/session";
import {getGroupDetails} from "@/lib/groups/service";
import {listRecurringRules,recurringNextDate} from "@/lib/recurring/service";
import {formatDateDMY} from "@/lib/date-format";
import {ActionLink,EmptyState,GroupedList,PageHeader} from "@/components/ui/app-screen";
import Link from "next/link";
const vnd=(v:string)=>new Intl.NumberFormat("vi-VN").format(BigInt(v))+" ₫";
export default async function MonthlyExpensesPage({params}:{params:Promise<{groupId:string}>}){
  const {groupId}=await params,user=await requireUser();
  const group=await getGroupDetails(groupId,user.id);if(!group)notFound();
  const rules=await listRecurringRules(groupId,user.id),base=`/groups/${groupId}/recurring`;
  return <main className="app-page space-y-6">
    <PageHeader title="Chi cố định" context={group.name} backHref={`/groups/${groupId}/manage`} backLabel="Quản lý" action={<ActionLink href={base+"/new"}>Thêm</ActionLink>}/>
    {rules.length===0?<EmptyState>Chưa có khoản chi cố định.</EmptyState>:<GroupedList>
      {rules.map(rule=><Link key={rule.id} href={base+"/"+rule.id} className="app-list-row items-start">
        <div className="min-w-0 flex-1"><strong>{rule.title}</strong><p className="app-caption mt-1">Ngày {rule.dayOfMonth} mỗi tháng</p>
          <p className="app-caption">{rule.status==="active"?`Lần tới ${formatDateDMY(recurringNextDate(rule))}`:"Đã tạm dừng"}</p></div>
        <strong className="max-w-[48%] break-words text-right tabular-nums">{vnd(rule.totalMinor)}</strong>
      </Link>)}
    </GroupedList>}
  </main>;
}
