"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { InlineConfirmation } from "@/components/ui/inline-confirmation";

/** Only rendered for the authenticated invoice creator when every debt is paid. */
export function CompleteExpenseButton({groupId,expenseId,version}:{
  groupId:string;expenseId:string;version:number;
}) {
  const router=useRouter();
  const [confirming,setConfirming]=useState(false);
  const [busy,setBusy]=useState(false);
  const [note,setNote]=useState("");
  const [error,setError]=useState("");

  async function complete() {
    if(busy)return;
    setBusy(true);
    setError("");
    try {
      const response=await fetch(`/api/groups/${groupId}/expenses/${expenseId}/complete`,{
        method:"POST",
        headers:{"content-type":"application/json"},
        credentials:"same-origin",
        cache:"no-store",
        body:JSON.stringify({expectedVersion:version,note}),
      });
      if(!response.ok) {
        const data:unknown=await response.json().catch(()=>null);
        const message=data&&typeof data==="object"&&"error" in data &&
          typeof (data as {error?:unknown}).error==="string"
          ? (data as {error:string}).error
          : "Không thể hoàn thành hóa đơn.";
        throw Error(message);
      }
      setConfirming(false);
      router.refresh();
    }catch(cause){
      setError(cause instanceof Error?cause.message:"Không thể kết nối. Hãy thử lại.");
    }finally{setBusy(false);}
  }

  return <div className="space-y-3">
    {!confirming &&
      <button type="button" disabled={busy}
        onClick={()=>{setConfirming(true);setError("");}}
        className="min-h-12 rounded-xl bg-money-in px-4 py-3 text-sm font-semibold text-white disabled:opacity-50">
        Xác nhận hoàn thành hóa đơn
      </button>}
    {confirming&&<InlineConfirmation
      title="Chốt hoàn thành hóa đơn?"
      description="Tất cả công nợ đã được xác nhận. Sau khi chốt, hóa đơn sẽ chuyển vào mục Đã hoàn thành và không thể sửa hoặc xóa. Lịch sử vẫn được giữ nguyên."
      confirmLabel="Xác nhận hoàn thành"
      note={note} onNoteChange={setNote}
      busy={busy} onConfirm={()=>void complete()}
      onCancel={()=>{setConfirming(false);setNote("");setError("");}}/>}
    {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
  </div>;
}
