import Link from "next/link";
import {PageHeader,SegmentedNav} from "@/components/ui/app-screen";
import { formatDateTimeDMY } from "@/lib/date-format";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { getSettlementDetail } from "@/lib/settlements/service";
import { SettlementActions } from "@/components/settlements/settlement-actions";
const vnd=(n:string)=>new Intl.NumberFormat("vi-VN").format(BigInt(n))+" ₫";
const labels={pending:"Chờ xác nhận",confirmed:"Đã xác nhận",rejected:"Đã từ chối",cancelled:"Đã hủy"};
export default async function SettlementPage({params,searchParams}:{
  params:Promise<{groupId:string;settlementId:string}>;
  searchParams:Promise<{view?:string}>;
}){
  const {groupId,settlementId}=await params;
  const q=await searchParams;
  const view=q.view==="details"||q.view==="history"?q.view:"confirm";
  const base=`/groups/${groupId}/settlements/${settlementId}`;
  const user=await requireUser();
  const result=await getSettlementDetail(groupId,settlementId,user.id);
  if(!result)notFound();
  const outgoing = result.debtorId === user.id;
  const incoming = result.creditorId === user.id;
  const color = outgoing ? "text-money-out" : incoming ? "text-money-in" : "text-foreground";
  const sign = outgoing ? "−" : incoming ? "+" : "";
  const eventLabel:Record<string,string>={
    created:"Tạo yêu cầu",confirmed:"Xác nhận hoàn trả",
    rejected:"Từ chối",cancelled:"Hủy yêu cầu",
  };
  const canConfirm=result.status==="pending" && result.initiatedBy!==user.id &&
    [result.debtorId,result.creditorId].includes(user.id);
  const canCancel=result.status==="pending" && result.initiatedBy===user.id;
  return <main className="app-page space-y-5">
    <PageHeader title={`${result.debtorName} trả ${result.creditorName}`} backHref={`/groups/${groupId}/settlements`} backLabel="Lịch sử trả tiền"/>
    <header className="rounded-2xl border bg-card p-5">
      <p className="text-sm text-muted-foreground">{labels[result.status]}</p>
      <p className={`mt-3 text-3xl font-bold tabular-nums ${color}`}>
        {sign}{vnd(result.amountMinor)}
      </p>
      <p className="mt-2 text-xs text-muted-foreground">
        Tạo: {formatDateTimeDMY(result.createdAt)}
        {result.resolvedAt ? ` · Xử lý: ${formatDateTimeDMY(result.resolvedAt)}` : ""}
      </p>
      <p className="mt-2 text-sm text-muted-foreground">Người tạo: {result.initiatedBy===result.debtorId?result.debtorName:result.creditorName}</p>
      {result.note&&<p className="mt-2 text-sm">{result.note}</p>}
    </header>
    <SegmentedNav label="Lần trả tiền" items={[
      {href:base,label:"Xác nhận",active:view==="confirm"},
      {href:base+"?view=details",label:"Các khoản",active:view==="details"},
      {href:base+"?view=history",label:"Lịch sử",active:view==="history"},
    ]}/>
    {view==="confirm"&&<>
    {result.status==="pending"&&<p className="rounded-xl bg-muted p-3 text-sm">
      Chờ bên kia xác nhận. Công nợ chưa thay đổi.
    </p>}
    {(canConfirm||canCancel)&&<SettlementActions groupId={groupId} settlementId={settlementId}
      canConfirm={canConfirm} canCancel={canCancel}/>}
    </>}
    {view==="details"&&<section className="space-y-3">
      <h2 className="font-semibold">Các khoản</h2>
      {result.allocations.map(a=><Link key={a.obligationId} href={`/groups/${groupId}/debts/${a.obligationId}`}
        className="flex items-center justify-between rounded-xl border p-3 text-sm">
        <span>{a.expenseTitle}</span><strong className={`tabular-nums ${color}`}>{sign}{vnd(a.amountMinor)}</strong>
      </Link>)}
    </section>}
    {view==="history"&&<section className="space-y-2"><h2 className="font-semibold">Lịch sử xác nhận</h2>
      {result.events.map((event,i)=><div key={i} className="rounded-xl border p-3 text-sm">
        <strong>{eventLabel[event.eventType]??event.eventType}</strong>
        <p className="text-xs text-muted-foreground">{formatDateTimeDMY(event.recordedAt)} · {event.actorId===result.debtorId?result.debtorName:event.actorId===result.creditorId?result.creditorName:"Thành viên"}</p>
        {event.note&&<p>{event.note}</p>}
      </div>)}
    </section>}
  </main>;
}
