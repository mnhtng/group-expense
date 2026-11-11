import Link from "next/link";
import {formatDateDMY,formatDateTimeDMY} from "@/lib/date-format";
import {notFound} from "next/navigation";
import {requireUser} from "@/lib/auth/session";
import {getGroupDetails} from "@/lib/groups/service";
import {canModifyExpense} from "@/lib/expenses/permissions";
import {getExpense} from "@/lib/expenses/service";
import {listExpenseDebts} from "@/lib/debts/service";
import {DeleteExpenseButton} from "@/components/expenses/delete-expense-button";
import {CompleteExpenseButton} from "@/components/expenses/complete-expense-button";
import {ActionLink,EmptyState,GroupedList,PageHeader,SegmentedNav} from "@/components/ui/app-screen";
const vnd=(v:string)=>new Intl.NumberFormat("vi-VN").format(BigInt(v))+" ₫";
export default async function ExpenseDetailPage({params,searchParams}:{params:Promise<{groupId:string;expenseId:string}>;searchParams:Promise<{tab?:string}>}){
  const {groupId,expenseId}=await params,{tab:raw}=await searchParams;
  const tab=raw==="items"||raw==="details"?raw:"split";
  const user=await requireUser();
  const group=await getGroupDetails(groupId,user.id);if(!group)notFound();
  const expense=await getExpense(groupId,expenseId,user.id);if(!expense)notFound();
  const debts=(await listExpenseDebts(groupId,expenseId,user.id))??[];
  const canEdit=canModifyExpense(expense.createdBy,user.id),completed=Boolean(expense.completedAt);
  const remaining=BigInt(expense.remainingMinor),pending=BigInt(expense.pendingMinor),confirmed=BigInt(expense.confirmedMinor);
  const allSettled=remaining===0n&&pending===0n&&expense.invalidCount===0;
  const editable=canEdit&&!completed&&confirmed===0n&&pending===0n;
  const base=`/groups/${groupId}/expenses/${expenseId}`;
  return <main className="app-page space-y-6">
    <PageHeader title={expense.title} backHref={`/groups/${groupId}`} backLabel={group.name}
      action={editable?<ActionLink secondary href={base+"/edit"}>Sửa</ActionLink>:undefined}/>
    <div className="space-y-2"><p className="app-money">{vnd(expense.totalMinor)}</p>
      <p className="text-muted-foreground">{expense.payerName} đã trả · {formatDateDMY(expense.occurredOn)}</p>
      <p className={`font-medium ${completed||allSettled?"text-money-in":"text-muted-foreground"}`}>{completed?"Đã chốt":allSettled?"Hết nợ · Chờ chốt":pending>0n?"Chờ xác nhận":`Còn nợ ${vnd(expense.remainingMinor)}`}</p></div>
    {!completed&&allSettled&&canEdit&&<CompleteExpenseButton groupId={groupId} expenseId={expenseId} version={expense.version}/>}
    <SegmentedNav label="Chi tiết khoản chi" items={[{href:base,label:"Chia tiền",active:tab==="split"},{href:base+"?tab=items",label:"Các món",active:tab==="items"},{href:base+"?tab=details",label:"Chi tiết",active:tab==="details"}]}/>
    {tab==="split"&&(debts.length===0?<EmptyState>Không có khoản cần hoàn trả.</EmptyState>:<GroupedList>
      {debts.map(d=><Link key={d.id} href={`/groups/${groupId}/debts/${d.id}`} className="app-list-row items-start">
        <div className="min-w-0 flex-1"><strong>{d.debtorName}</strong><p className="app-caption mt-1">Trả {d.creditorName}</p>
          <p className="app-caption">{BigInt(d.outstandingMinor)===0n?"Đã xong":BigInt(d.pendingMinor)>0n?"Chờ xác nhận":"Chưa trả đủ"}</p></div>
        <strong className="max-w-[48%] break-words text-right tabular-nums">{vnd(d.outstandingMinor)}</strong>
      </Link>)}
    </GroupedList>)}
    {tab==="items"&&<section className="space-y-3">{expense.items.map(item=><article key={item.id} className="app-panel space-y-3">
      <div className="flex justify-between gap-3"><strong>{item.name}</strong><strong className="shrink-0 tabular-nums">{vnd(item.amountMinor)}</strong></div>
      <p className="app-caption">{item.quantity} × {vnd(item.unitPriceMinor)}</p>
      <div className="space-y-2 border-t pt-3">{item.shares.map(share=><div key={share.userId} className="flex justify-between gap-3"><span>{share.userName}</span><span className="tabular-nums">{vnd(share.amountMinor)}</span></div>)}</div>
    </article>)}</section>}
    {tab==="details"&&<>
      <section className="app-panel space-y-4"><h2 className="text-xl font-semibold">Số tiền</h2>
        <dl className="space-y-3">{[["Nợ ban đầu",expense.dueMinor],["Tiền đã xác nhận",expense.confirmedCashMinor],["Đã bù nợ",expense.confirmedSetoffMinor],["Chờ xác nhận",expense.pendingMinor],["Còn nợ",expense.remainingMinor]].map(([label,v])=><div key={label} className="flex justify-between gap-3"><dt className="text-muted-foreground">{label}</dt><dd className="font-semibold tabular-nums">{vnd(v)}</dd></div>)}</dl>
      </section>
      <section className="app-panel space-y-3"><h2 className="text-xl font-semibold">Thông tin</h2><p>{expense.creatorName} tạo khoản chi.</p>
        {expense.notes&&<p className="whitespace-pre-wrap break-words">{expense.notes}</p>}
        {expense.completedAt&&<p>Chốt {formatDateTimeDMY(expense.completedAt)}</p>}
        {expense.completionNote&&<p className="whitespace-pre-wrap break-words">{expense.completionNote}</p>}
        {expense.recurringRuleId&&<ActionLink secondary href={`/groups/${groupId}/recurring/${expense.recurringRuleId}`}>Xem lịch chi cố định</ActionLink>}
      </section>
      {editable&&<DeleteExpenseButton groupId={groupId} expenseId={expenseId} version={expense.version}/>}
    </>}
  </main>;
}
