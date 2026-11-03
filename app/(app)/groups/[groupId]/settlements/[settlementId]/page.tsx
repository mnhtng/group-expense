import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { getSettlementDetail } from "@/lib/settlements/service";
import { SettlementActions } from "@/components/settlements/settlement-actions";
const vnd=(n:string)=>new Intl.NumberFormat("vi-VN").format(BigInt(n))+" ₫";
const labels={pending:"Chờ xác nhận",confirmed:"Đã xác nhận",rejected:"Đã từ chối",cancelled:"Đã hủy"};
export default async function SettlementPage({params}:{
  params:Promise<{groupId:string;settlementId:string}>;
}){
  const {groupId,settlementId}=await params;
  const user=await requireUser();
  const result=await getSettlementDetail(groupId,settlementId,user.id);
  if(!result)notFound();
  const outgoing = result.debtorId === user.id;
  const incoming = result.creditorId === user.id;
  const color = outgoing ? "text-money-out" : incoming ? "text-money-in" : "text-foreground";
  const sign = outgoing ? "−" : incoming ? "+" : "";
  const dateTime = (value:string) => new Intl.DateTimeFormat("vi-VN",{
    day:"2-digit",month:"2-digit",year:"numeric",
    hour:"2-digit",minute:"2-digit",timeZone:"Asia/Ho_Chi_Minh",
  }).format(new Date(value));
  const eventLabel:Record<string,string>={
    created:"Tạo yêu cầu",confirmed:"Xác nhận hoàn trả",
    rejected:"Từ chối",cancelled:"Hủy yêu cầu",
  };
  const canConfirm=result.status==="pending" && result.initiatedBy!==user.id &&
    [result.debtorId,result.creditorId].includes(user.id);
  const canCancel=result.status==="pending" && result.initiatedBy===user.id;
  return <main className="app-page space-y-5">
    <Link href={`/groups/${groupId}/settlements`} className="text-sm text-muted-foreground">
      ← Giao dịch của nhóm
    </Link>
    <header className="rounded-2xl border bg-card p-5">
      <p className="text-sm text-muted-foreground">{labels[result.status]}</p>
      <h1 className="mt-2 text-xl font-semibold">{result.debtorName} trả cho {result.creditorName}</h1>
      <p className={`mt-3 text-3xl font-bold tabular-nums ${color}`}>
        {sign}{vnd(result.amountMinor)}
      </p>
      <p className="mt-2 text-xs text-muted-foreground">
        Tạo: {dateTime(result.createdAt)}
        {result.resolvedAt ? ` · Xử lý: ${dateTime(result.resolvedAt)}` : ""}
      </p>
      <p className="mt-2 text-sm text-muted-foreground">Người tạo: {result.initiatedBy===result.debtorId?result.debtorName:result.creditorName}</p>
      {result.note&&<p className="mt-2 text-sm">{result.note}</p>}
    </header>
    {result.status==="pending"&&<p className="rounded-xl bg-muted p-3 text-sm">
      Chờ bên kia xác nhận. Công nợ chưa thay đổi.
    </p>}
    {(canConfirm||canCancel)&&<SettlementActions groupId={groupId} settlementId={settlementId}
      canConfirm={canConfirm} canCancel={canCancel}/>}
    <section className="space-y-3">
      <h2 className="font-semibold">Các khoản thanh toán</h2>
      {result.allocations.map(a=><Link key={a.obligationId} href={`/groups/${groupId}/debts/${a.obligationId}`}
        className="flex items-center justify-between rounded-xl border p-3 text-sm">
        <span>{a.expenseTitle}</span><strong className={`tabular-nums ${color}`}>{sign}{vnd(a.amountMinor)}</strong>
      </Link>)}
    </section>
    <section className="space-y-2"><h2 className="font-semibold">Lịch sử xác nhận</h2>
      {result.events.map((event,i)=><div key={i} className="rounded-xl border p-3 text-sm">
        <strong>{eventLabel[event.eventType]??event.eventType}</strong>
        <p className="text-xs text-muted-foreground">{dateTime(event.recordedAt)} · {event.actorId===result.debtorId?result.debtorName:event.actorId===result.creditorId?result.creditorName:"Thành viên"}</p>
        {event.note&&<p>{event.note}</p>}
      </div>)}
    </section>
  </main>;
}
