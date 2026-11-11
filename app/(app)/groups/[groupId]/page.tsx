import {requireUser} from "@/lib/auth/session";
import {getGroupDetails,getMemberRole} from "@/lib/groups/service";
import {countExpenseStatuses,listExpenses,type ExpenseListFilter} from "@/lib/expenses/service";
import {ActionLink,AppIcon,EmptyState,GroupedList,PageHeader,SegmentedNav} from "@/components/ui/app-screen";
import Link from "next/link";
import {formatDateDMY} from "@/lib/date-format";
import {notFound,redirect} from "next/navigation";
const vnd=(v:string)=>new Intl.NumberFormat("vi-VN").format(BigInt(v))+" ₫";
export default async function GroupPage({params,searchParams}:{
  params:Promise<{groupId:string}>;searchParams:Promise<{invite?:string;invoices?:string}>;
}){
  const {groupId}=await params,{invite,invoices}=await searchParams;
  const user=await requireUser();
  if(!await getMemberRole(groupId,user.id))notFound();
  const group=await getGroupDetails(groupId,user.id);if(!group)notFound();
  if(invite)redirect(`/groups/${groupId}/manage?section=invite&invite=${encodeURIComponent(invite)}`);
  const filter:ExpenseListFilter=invoices==="completed"?"completed":"active";
  const [expenses,counts]=await Promise.all([listExpenses(groupId,user.id,filter),countExpenseStatuses(groupId,user.id)]);
  const base=`/groups/${groupId}`;
  return <main className="app-page space-y-6">
    <PageHeader title={group.name} backHref="/groups" backLabel="Nhóm" action={
      <Link href={`${base}/manage`} aria-label="Quản lý nhóm" className="flex size-12 items-center justify-center rounded-full bg-card"><AppIcon name="more"/></Link>}/>
    <SegmentedNav label="Trong nhóm" items={[{href:base,label:"Chi tiêu",active:true},{href:base+"/debts",label:"Công nợ",active:false}]}/>
    <div className="flex items-center justify-between gap-3"><h2 className="text-xl font-semibold">Khoản chi</h2>
      <ActionLink href={base+"/expenses/new"}><AppIcon name="add"/>Thêm khoản</ActionLink></div>
    <SegmentedNav label="Lọc khoản chi" items={[
      {href:base,label:`Chưa chốt (${counts.active})`,active:filter==="active"},
      {href:base+"?invoices=completed",label:`Đã chốt (${counts.completed})`,active:filter==="completed"},
    ]}/>
    {expenses.length===0?<EmptyState>{filter==="completed"?"Chưa có khoản đã chốt.":"Chưa có khoản chi."}</EmptyState>:
      <GroupedList label="Danh sách khoản chi">{expenses.map(invoice=>{
        const pending=BigInt(invoice.pendingMinor)>0n;
        const paid=BigInt(invoice.remainingMinor)===0n&&!pending;
        const status=invoice.completedAt?"Đã chốt":pending?"Chờ xác nhận":paid?"Chờ chốt":"Chưa trả đủ";
        return <Link key={invoice.id} href={`${base}/expenses/${invoice.id}`} className="app-list-row items-start">
          <div className="min-w-0 flex-1 space-y-1">
            <strong className="block break-words text-lg">{invoice.title}</strong>
            <p className="app-caption">{invoice.payerName} · {formatDateDMY(invoice.occurredOn)}</p>
            <span className={`text-sm ${paid||invoice.completedAt?"text-money-in":"text-muted-foreground"}`}>{status}</span>
          </div>
          <strong className="max-w-[48%] break-words text-right text-lg tabular-nums">{vnd(invoice.totalMinor)}</strong>
        </Link>;
      })}</GroupedList>}
    {expenses.length===100&&<p className="app-caption">100 khoản gần nhất</p>}
  </main>;
}
