import Link from "next/link";
import {formatDateDMY} from "@/lib/date-format";
import type {CycleSourcePage} from "@/lib/settlement-cycles/ui-read";

const cash=(v:string)=>new Intl.NumberFormat("vi-VN").format(BigInt(v))+" ₫";
type Member={id:string;name:string};
export function SettlementCycleSourceList({groupId,cycleId,source,members}:{
  groupId:string;cycleId:string;source:CycleSourcePage;members:Member[];
}){
  const name=(id:string)=>members.find(m=>m.id===id)?.name??"Thành viên không còn trong danh sách";
  const totals=source.totals;
  const base=`/groups/${groupId}/cycles/${cycleId}`;
  return <section aria-labelledby="cycle-original-debts"
    className="space-y-4 rounded-3xl border bg-card p-4 sm:p-5">
    <header className="space-y-1">
      <h2 id="cycle-original-debts" className="text-lg font-semibold">Công nợ gốc trong kỳ</h2>
      <p className="text-sm text-muted-foreground">
        Tổng hợp từ toàn bộ {totals.sourceCount} nghĩa vụ gốc.
        Không cộng lại từ danh sách phân trang.
      </p>
    </header>
    <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {[
        ["Nợ gốc",totals.originalMinor],
        ["Đã xác nhận tiền mặt",totals.cashMinor],
        ["Đã bù trừ phi tiền mặt",totals.noncashMinor],
        ["Tiền mặt đang chờ",totals.pendingCashMinor],
        ["Nợ còn lại",totals.outstandingMinor],
        ["Có thể thanh toán",totals.availableMinor],
      ].map(([title,amount])=><div key={title}
        className="min-w-0 space-y-1 rounded-2xl bg-secondary/60 p-3">
        <dt className="text-xs text-muted-foreground">{title}</dt>
        <dd className="break-all text-sm font-semibold tabular-nums">{cash(amount)}</dd>
      </div>)}
    </dl>
    <p className="text-xs text-muted-foreground">
      Tiền mặt chờ xác nhận chỉ giữ chỗ; chỉ tiền mặt đã xác nhận và
      bù trừ đã áp dụng mới giảm công nợ.
    </p>
    {source.lines.length===0&&<p className="rounded-xl border border-dashed p-5 text-center text-sm text-muted-foreground">
      Kỳ này không có nghĩa vụ thanh toán giữa các thành viên.
    </p>}
    <ol className="space-y-3" aria-label="Nguồn công nợ gốc">
      {source.lines.map(line=><li key={line.obligationId}
        className="space-y-3 rounded-2xl border p-3.5 sm:p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <Link href={`/groups/${groupId}/expenses/${line.expenseId}`}
              className="inline-flex min-h-10 items-center break-words font-semibold underline-offset-4 hover:underline">
              {line.expenseTitle}
            </Link>
            <p className="text-xs text-muted-foreground">
              Phát sinh {formatDateDMY(line.occurredOn)} · {name(line.debtorId)} → {name(line.creditorId)}
            </p>
          </div>
          <strong className="shrink-0 text-sm tabular-nums">{cash(line.outstandingMinor)}</strong>
        </div>
        <div className="flex flex-wrap gap-1.5 text-xs">
          {line.attributedLate&&<span className="rounded-full bg-secondary px-2.5 py-1 font-medium">
            Hóa đơn nhập muộn · có chứng từ gán kỳ
          </span>}
          {line.invoiceCompleted&&<span className="rounded-full bg-secondary px-2.5 py-1">
            Chủ hóa đơn đã chốt
          </span>}
          {BigInt(line.pendingCashMinor)>0n&&<span className="rounded-full bg-secondary px-2.5 py-1">
            Chờ xác nhận tiền mặt
          </span>}
        </div>
        <dl className="grid grid-cols-2 gap-2 border-t pt-3 text-xs">
          <div><dt className="text-muted-foreground">Nợ gốc</dt><dd className="tabular-nums font-medium">{cash(line.originalMinor)}</dd></div>
          <div><dt className="text-muted-foreground">Tiền mặt đã xác nhận</dt><dd className="tabular-nums font-medium">{cash(line.confirmedCashMinor)}</dd></div>
          <div><dt className="text-muted-foreground">Bù trừ phi tiền mặt</dt><dd className="tabular-nums font-medium">{cash(line.confirmedSetoffMinor)}</dd></div>
          <div><dt className="text-muted-foreground">Tiền mặt chờ xác nhận</dt><dd className="tabular-nums font-medium">{cash(line.pendingCashMinor)}</dd></div>
        </dl>
        <p className="break-all text-[11px] text-muted-foreground">
          Mã nghĩa vụ gốc: <code>{line.obligationId}</code>
        </p>
      </li>)}
    </ol>
    {source.totals.sourceCount>50&&
      <nav aria-label="Phân trang nguồn công nợ"
        className="flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-sm">
        <span>Trang {source.page}/{source.totalPages}</span>
        <div className="flex gap-2">
          {source.page>1&&<Link href={`${base}?page=${source.page-1}#cycle-original-debts`}
            className="inline-flex min-h-11 items-center rounded-xl border px-4">Trước</Link>}
          {source.page<source.totalPages&&<Link
            href={`${base}?page=${source.page+1}#cycle-original-debts`}
            className="inline-flex min-h-11 items-center rounded-xl border px-4">Tiếp</Link>}
        </div>
      </nav>}
  </section>;
}
