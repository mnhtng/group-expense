import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { getGroupDetails } from "@/lib/groups/service";
import { listGroupSettlements } from "@/lib/settlements/service";
const vnd=(n:string)=>new Intl.NumberFormat("vi-VN").format(BigInt(n))+" ₫";
const labels={pending:"Chờ xác nhận",confirmed:"Đã xác nhận",rejected:"Đã từ chối",cancelled:"Đã hủy"};
export default async function SettlementsPage({params}:{params:Promise<{groupId:string}>}){
  const {groupId}=await params;const user=await requireUser();
  const [group,settlements]=await Promise.all([
    getGroupDetails(groupId,user.id),listGroupSettlements(groupId,user.id),
  ]);
  if(!group||!settlements)notFound();
  return <main className="mx-auto min-h-dvh max-w-lg space-y-4 px-5 py-8">
    <Link href={`/groups/${groupId}/debts`} className="text-sm text-muted-foreground">← Sổ công nợ {group.name}</Link>
    <h1 className="text-2xl font-semibold">Xác nhận thanh toán</h1>
    <p className="text-sm text-muted-foreground">Cả hai bên đều có thể báo đã trả/đã nhận. Chỉ người còn lại xác nhận.</p>
    {settlements.length===0&&<p className="rounded-xl border p-5 text-sm text-muted-foreground">Chưa có yêu cầu thanh toán nào.</p>}
    {settlements.map(x=><Link key={x.id} href={`/groups/${groupId}/settlements/${x.id}`}
      className="block space-y-2 rounded-2xl border bg-card p-4">
      <p className="text-xs text-muted-foreground">{labels[x.status]}</p>
      <div className="flex justify-between gap-3 text-sm">
        <span>{x.debtorName} → {x.creditorName}</span>
        <strong className="tabular-nums">{vnd(x.amountMinor)}</strong>
      </div>
    </Link>)}
  </main>;
}
