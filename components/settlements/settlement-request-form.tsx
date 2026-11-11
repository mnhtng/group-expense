"use client";
import { useRef, useState, type FormEvent } from "react";
import {OptionalNoteField} from "@/components/ui/optional-note-field";
import { useRouter } from "next/navigation";
export function SettlementRequestForm({groupId,debtId,availableMinor,direction}:{
  groupId:string;debtId:string;availableMinor:string;direction:"debtor"|"creditor";
}) {
  const router=useRouter();
  const [amount,setAmount]=useState(availableMinor);
  const [note,setNote]=useState("");
  const [error,setError]=useState("");
  const [saving,setSaving]=useState(false);
  const requestKey=useRef<string|null>(null);
  async function submit(e:FormEvent<HTMLFormElement>){
    e.preventDefault();
    if(saving)return;
    setSaving(true);setError("");
    if(!requestKey.current)requestKey.current=crypto.randomUUID();
    try{
      const response=await fetch(`/api/groups/${groupId}/settlements`,{
        method:"POST",headers:{"Content-Type":"application/json"},credentials:"same-origin",cache:"no-store",
        body:JSON.stringify({requestKey:requestKey.current,
          allocations:[{obligationId:debtId,amountMinor:amount}],note}),
      });
      const result=await response.json();
      if(!response.ok){setError(result.error??"Không thể tạo yêu cầu.");return;}
      router.push(`/groups/${groupId}/settlements/${result.id}`);
      router.refresh();
    }catch{setError("Mất kết nối. Thử lại để kiểm tra trạng thái.");}
    finally{setSaving(false)}
  }
  if(BigInt(availableMinor)===0n)return null;
  return <form onSubmit={submit} className="space-y-3 rounded-2xl border bg-card p-4">
    <h2 className="font-semibold">{direction==="debtor"?"Thông báo đã trả":"Thông báo đã nhận tiền"}</h2>
    <p className="text-xs text-muted-foreground">Công nợ chỉ giảm sau khi bên kia xác nhận.</p>
    <label className="block text-sm">Số tiền (VND)
      <input required inputMode="numeric" pattern="[1-9][0-9]*" value={amount}
        onChange={e=>{setAmount(e.target.value.trim());requestKey.current=null;}}
        className="mt-1 w-full rounded-xl border bg-background p-3 text-base"/>
    </label>
    <OptionalNoteField value={note} onChange={value=>{setNote(value);requestKey.current=null;}} maxLength={500}/>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <button disabled={saving} className="rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-50">
      {saving?"Đang gửi...":"Gửi yêu cầu"}
    </button>
  </form>;
}
