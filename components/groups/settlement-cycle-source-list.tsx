import Link from "next/link";
import {formatDateDMY} from "@/lib/date-format";
import type {CycleSourcePage} from "@/lib/settlement-cycles/ui-read";
const cash=(v:string)=>new Intl.NumberFormat("vi-VN").format(BigInt(v))+" ₫";
type Member={id:string;name:string};
export function SettlementCycleSourceList({groupId,cycleId,source,members}:{groupId:string;cycleId:string;source:CycleSourcePage;members:Member[]}){
  const name=(id:string)=>members.find(m=>m.id===id)?.name??"Thành viên cũ";
  const totals=source.totals,base=`/groups/${groupId}/cycles/${cycleId}`;
  return <section aria-labelledby="cycle-original-debts" className="space-y-4">
    <header><h2 id="cycle-original-debts" className="text-xl font-semibold">Khoản trong kỳ</h2>
      <p className="app-caption mt-1">{totals.sourceCount} khoản nợ</p></header>
    <div className="app-panel space-y-3"><p className="text-muted-foreground">Còn nợ</p><p className="app-money">{cash(totals.outstandingMinor)}</p>
      <details><summary className="min-h-11 cursor-pointer py-2 font-medium">Chi tiết số tiền</summary>
        <dl className="grid grid-cols-2 gap-4 pt-3">{[
          ["Ban đầu",totals.originalMinor],["Tiền đã xác nhận",totals.cashMinor],
          ["Đã bù nợ",totals.noncashMinor],["Chờ xác nhận",totals.pendingCashMinor],
          ["Còn nợ",totals.outstandingMinor],["Có thể trả",totals.availableMinor],
        ].map(([label,v])=><div key={label}><dt className="app-caption">{label}</dt><dd className="break-words font-semibold tabular-nums">{cash(v)}</dd></div>)}</dl>
      </details></div>
    {source.lines.length===0&&<p className="app-empty">Không có khoản nợ.</p>}
    <ol className="space-y-3" aria-label="Nguồn công nợ gốc">{source.lines.map(line=><li key={line.obligationId} className="app-panel space-y-2">
      <div className="flex items-start justify-between gap-3"><Link href={`/groups/${groupId}/expenses/${line.expenseId}`} className="min-h-11 min-w-0 flex-1 break-words font-semibold">{line.expenseTitle}</Link>
        <strong className="max-w-[48%] break-words text-right tabular-nums">{cash(line.outstandingMinor)}</strong></div>
      <p className="app-caption">{name(line.debtorId)} trả {name(line.creditorId)}</p>
      <p className="app-caption">{formatDateDMY(line.occurredOn)}{line.attributedLate?" · Nhập muộn":""}{BigInt(line.pendingCashMinor)>0n?" · Chờ xác nhận":""}</p>
      <details><summary className="min-h-11 cursor-pointer py-2 text-sm">Chi tiết khoản nợ</summary>
        <dl className="grid grid-cols-2 gap-3 py-3">{[
          ["Ban đầu",line.originalMinor],["Tiền đã xác nhận",line.confirmedCashMinor],
          ["Đã bù nợ",line.confirmedSetoffMinor],["Chờ xác nhận",line.pendingCashMinor],
        ].map(([label,v])=><div key={label}><dt className="app-caption">{label}</dt><dd className="tabular-nums">{cash(v)}</dd></div>)}</dl>
        <p className="app-caption break-all">Mã khoản: <code>{line.obligationId}</code></p>
      </details>
    </li>)}</ol>
    {totals.sourceCount>50&&<nav aria-label="Phân trang nguồn công nợ" className="flex items-center justify-between gap-3">
      <span className="app-caption">Trang {source.page}/{source.totalPages}</span><div className="flex gap-2">
        {source.page>1&&<Link className="app-action app-action-secondary" href={`${base}?view=sources&page=${source.page-1}#cycle-original-debts`}>Trước</Link>}
        {source.page<source.totalPages&&<Link className="app-action app-action-secondary" href={`${base}?view=sources&page=${source.page+1}#cycle-original-debts`}>Tiếp</Link>}
      </div></nav>}
  </section>;
}
