import Link from "next/link";
import {formatDateDMY} from "@/lib/date-format";
import type {DebtRow} from "@/lib/debts/service";
const vnd=(v:string)=>new Intl.NumberFormat("vi-VN").format(BigInt(v))+" ₫";
export function DebtCard({debt,viewerId,showGroup=false}:{debt:DebtRow;viewerId:string;showGroup?:boolean}){
  const outgoing=debt.debtorId===viewerId,incoming=debt.creditorId===viewerId;
  const relation=outgoing?`Trả ${debt.creditorName}`:incoming?`Nhận từ ${debt.debtorName}`:`${debt.debtorName} trả ${debt.creditorName}`;
  const pending=BigInt(debt.pendingMinor)>0n;
  const prefix=outgoing?"−":incoming?"+":"";
  return <Link href={`/groups/${debt.groupId}/debts/${debt.id}`} className="app-panel block space-y-2"
    aria-label={`${relation}, ${debt.expenseTitle}, còn ${vnd(debt.outstandingMinor)}`}>
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0"><p className="font-semibold">{relation}</p>
        <p className="app-caption mt-1 break-words">{debt.expenseTitle}</p></div>
      <strong className={`max-w-[50%] break-words text-right text-xl tabular-nums ${outgoing?"text-money-out":incoming?"text-money-in":"text-foreground"}`}>
        {prefix}{vnd(debt.outstandingMinor)}
      </strong>
    </div>
    <p className="app-caption">{showGroup?`${debt.groupName} · `:""}{formatDateDMY(debt.occurredOn)}{BigInt(debt.outstandingMinor)===0n?" · Hết nợ":pending?" · Chờ xác nhận":""}</p>
  </Link>;
}
