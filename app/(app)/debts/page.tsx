import Link from "next/link";
import {requireUser} from "@/lib/auth/session";
import {listPersonalDebts,listPersonalDebtItems,sumDebtAmounts} from "@/lib/debts/service";
import {listPersonalSettlements} from "@/lib/settlements/service";
import {DebtCard} from "@/components/debts/debt-card";
import {EmptyState,GroupedList,PageHeader,SegmentedNav} from "@/components/ui/app-screen";
const vnd=(v:string)=>new Intl.NumberFormat("vi-VN").format(BigInt(v))+" ₫";
export default async function DebtsPage({searchParams}:{searchParams:Promise<{tab?:string}>}){
  const user=await requireUser(),{tab:raw}=await searchParams;
  const tab=raw==="receive"||raw==="pending"?raw:"pay";
  const [debts,items,settlements]=await Promise.all([listPersonalDebts(user.id),listPersonalDebtItems(user.id),listPersonalSettlements(user.id)]);
  const rows=items.filter(d=>tab==="receive"?d.creditorId===user.id:d.debtorId===user.id);
  const total=sumDebtAmounts(debts.filter(d=>d.direction===tab));
  return <main className="app-page space-y-6">
    <PageHeader title="Công nợ"/>
    <SegmentedNav label="Loại công nợ" items={[
      {href:"/debts",label:"Bạn trả",active:tab==="pay"},
      {href:"/debts?tab=receive",label:"Bạn nhận",active:tab==="receive"},
      {href:"/debts?tab=pending",label:"Chờ xác nhận",active:tab==="pending"},
    ]}/>
    {tab!=="pending"?<>
      <div className="space-y-2 py-2"><p className="text-muted-foreground">{tab==="pay"?"Cần trả":"Được nhận"}</p>
        <p className={`app-money ${tab==="pay"?"text-money-out":"text-money-in"}`}>{vnd(total)}</p></div>
      {rows.length===0?<EmptyState>Không còn khoản nào.</EmptyState>:<section className="space-y-3" aria-label={tab==="pay"?"Khoản cần trả":"Khoản được nhận"}>
        {rows.map(debt=><DebtCard key={debt.id} debt={debt} viewerId={user.id} showGroup/>)}</section>}
      {items.length===250&&<p className="app-caption">Đang hiện 250 khoản gần nhất.</p>}
    </>:settlements.length===0?<EmptyState>Không có yêu cầu chờ.</EmptyState>:<GroupedList>
      {settlements.map(s=><Link key={s.id} href={`/groups/${s.groupId}/settlements/${s.id}`} className="app-list-row items-start">
        <div className="min-w-0 flex-1"><strong>{s.initiatedBy===user.id?"Đã gửi yêu cầu":"Chờ bạn xác nhận"}</strong>
          <p className="app-caption mt-1">{s.debtorName} trả {s.creditorName}</p><p className="app-caption">{s.groupName}</p></div>
        <strong className="max-w-[45%] break-words text-right text-lg tabular-nums">{vnd(s.amountMinor)}</strong>
      </Link>)}
    </GroupedList>}
  </main>;
}
