import {notFound} from "next/navigation";
import {requireUser} from "@/lib/auth/session";
import {getGroupDetails} from "@/lib/groups/service";
import {listGroupDebts,getGroupDebtTotals} from "@/lib/debts/service";
import {DebtCard} from "@/components/debts/debt-card";
import {ActionLink,EmptyState,GroupedList,NavigationRow,PageHeader,SegmentedNav} from "@/components/ui/app-screen";
const vnd=(v:string)=>new Intl.NumberFormat("vi-VN").format(BigInt(v))+" ₫";
export default async function GroupDebtsPage({params,searchParams}:{params:Promise<{groupId:string}>;searchParams:Promise<{tab?:string}>}){
  const {groupId}=await params,{tab:raw}=await searchParams;
  const tab=raw==="receive"||raw==="all"?raw:"pay";
  const user=await requireUser();
  const [group,debts,totals]=await Promise.all([getGroupDetails(groupId,user.id),listGroupDebts(groupId,user.id),getGroupDebtTotals(groupId,user.id)]);
  if(!group||!debts||!totals)notFound();
  const rows=tab==="all"?debts:debts.filter(d=>BigInt(d.outstandingMinor)>0n&&(tab==="pay"?d.debtorId===user.id:d.creditorId===user.id));
  const base=`/groups/${groupId}`;
  return <main className="app-page space-y-6">
    <PageHeader title="Công nợ" context={group.name} backHref={base} backLabel="Nhóm" action={<ActionLink href={base+"/settlements/new"}>Trả tiền</ActionLink>}/>
    <SegmentedNav label="Loại công nợ" items={[
      {href:base+"/debts",label:"Bạn trả",active:tab==="pay"},
      {href:base+"/debts?tab=receive",label:"Bạn nhận",active:tab==="receive"},
      {href:base+"/debts?tab=all",label:"Cả nhóm",active:tab==="all"},
    ]}/>
    <div className="space-y-2 py-2"><p className="text-muted-foreground">{tab==="pay"?"Cần trả":tab==="receive"?"Được nhận":"Còn nợ trong nhóm"}</p>
      <p className={`app-money ${tab==="pay"?"text-money-out":tab==="receive"?"text-money-in":""}`}>
        {vnd(tab==="pay"?totals.myPayableMinor:tab==="receive"?totals.myReceivableMinor:totals.outstandingMinor)}</p></div>
    {rows.length===0?<EmptyState>Không còn khoản nào.</EmptyState>:<section className="space-y-3" aria-label="Các khoản nợ">
      {rows.map(d=><DebtCard key={d.id} debt={d} viewerId={user.id}/>)}</section>}
    <GroupedList><NavigationRow href={base+"/settlements"} title="Lịch sử trả tiền"/></GroupedList>
  </main>;
}
