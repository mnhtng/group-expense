"use client";
import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

type DebtOption={
  id:string; debtorId:string;debtorName:string;creditorId:string;creditorName:string;
  expenseTitle:string;availableMinor:string;
};
type Pair={key:string;label:string;debts:DebtOption[]};
const vnd=(n:string)=>new Intl.NumberFormat("vi-VN").format(BigInt(n))+" ₫";

export function BatchSettlementForm({groupId,pairs}:{
  groupId:string;pairs:Pair[];
}){
  const router=useRouter();
  const [pairKey,setPairKey]=useState(pairs[0]?.key??"");
  const [selected,setSelected]=useState<string[]>([]);
  const [amounts,setAmounts]=useState<Record<string,string>>({});
  const [note,setNote]=useState("");
  const [error,setError]=useState("");
  const [saving,setSaving]=useState(false);
  const requestKey=useRef<string|null>(null);
  const pair=pairs.find(x=>x.key===pairKey);
  const chosen=(pair?.debts??[]).filter(d=>selected.includes(d.id));
  const total=chosen.reduce((sum,d)=>{
    const amount=amounts[d.id]??d.availableMinor;
    return /^[0-9]+$/.test(amount)?sum+BigInt(amount):sum;
  },0n).toString();
  const invalidate=()=>{requestKey.current=null;setError("")};
  async function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    if(saving || !chosen.length)return;
    setSaving(true);setError("");
    requestKey.current??=crypto.randomUUID();
    try{
      const response=await fetch(`/api/groups/${groupId}/settlements`,{
        method:"POST",credentials:"same-origin",cache:"no-store",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({requestKey:requestKey.current,note,
          allocations:chosen.map(d=>({obligationId:d.id,amountMinor:amounts[d.id]??d.availableMinor}))}),
      });
      const data=await response.json();
      if(!response.ok){setError(data.error??"Không thể tạo yêu cầu.");return;}
      router.push(`/groups/${groupId}/settlements/${data.id}`);
      router.refresh();
    }catch{setError("Mất kết nối. Thử lại để kiểm tra trạng thái.");}
    finally{setSaving(false)}
  }
  if(!pairs.length)return <p className="rounded-xl border border-dashed p-5 text-sm text-muted-foreground">
    Không có khoản nào có thể thanh toán.
  </p>;
  return <form onSubmit={submit} className="space-y-5 pb-20">
    <label className="block text-sm font-medium">Người trả / người nhận
      <select value={pairKey} onChange={e=>{setPairKey(e.target.value);setSelected([]);invalidate();}}
        className="mt-2 w-full rounded-xl border bg-background p-3">
        {pairs.map(p=><option key={p.key} value={p.key}>{p.label}</option>)}
      </select>
    </label>
    <div className="space-y-3">
      {(pair?.debts??[]).map(debt=>{
        const checked=selected.includes(debt.id);
        return <div key={debt.id} className="space-y-2 rounded-xl border bg-card p-4">
          <label className="flex cursor-pointer items-start gap-3">
            <input type="checkbox" checked={checked} onChange={e=>{
              setSelected(old=>e.target.checked?[...old,debt.id]:old.filter(id=>id!==debt.id));
              invalidate();
            }} className="mt-1"/>
            <span className="min-w-0 flex-1">
              <strong className="block text-sm">{debt.expenseTitle}</strong>
              <span className="block text-xs text-muted-foreground">
                Có thể thanh toán: {vnd(debt.availableMinor)}
              </span>
            </span>
          </label>
          {checked&&<label className="block text-xs">Số tiền (VND)
            <input required inputMode="numeric" pattern="[1-9][0-9]*"
              value={amounts[debt.id]??debt.availableMinor}
              onChange={e=>{setAmounts(old=>({...old,[debt.id]:e.target.value}));invalidate();}}
              className="mt-1 w-full rounded-xl border bg-background p-3 text-base"/>
          </label>}
        </div>;
      })}
    </div>
    <label className="block text-sm font-medium">Ghi chú (không bắt buộc)
      <textarea maxLength={500} value={note} rows={2}
        onChange={e=>{setNote(e.target.value);invalidate();}}
        className="mt-2 w-full rounded-xl border bg-background p-3"/>
    </label>
    <div className="rounded-xl border bg-muted p-4">
      <p className="text-xs text-muted-foreground">{chosen.length} khoản</p>
      <p className="mt-1 text-xl font-bold tabular-nums">{vnd(total)}</p>
      <p className="mt-2 text-xs text-muted-foreground">
        Công nợ chỉ giảm sau khi bên kia xác nhận.
      </p>
    </div>
    {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
    <button type="submit" disabled={saving||!chosen.length}
      className="w-full rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-50">
      {saving?"Đang gửi...":"Gửi yêu cầu"}
    </button>
  </form>;
}
