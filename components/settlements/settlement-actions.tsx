"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
export function SettlementActions({groupId,settlementId,canConfirm,canCancel}:{
  groupId:string;settlementId:string;canConfirm:boolean;canCancel:boolean;
}) {
  const router=useRouter();const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  async function decide(action:"confirm"|"reject"|"cancel"){
    if(busy)return;
    if(action==="confirm"&&!window.confirm("Xác nhận số tiền thực sự đã được chuyển/nhận? Chỉ xác nhận khi bạn đã đối chiếu."))return;
    setBusy(true);setError("");
    try{
      const res=await fetch(`/api/groups/${groupId}/settlements/${settlementId}`,{
        method:"PATCH",headers:{"Content-Type":"application/json"},
        credentials:"same-origin",cache:"no-store",body:JSON.stringify({action}),
      });
      if(!res.ok){const data=await res.json();setError(data.error??"Không thể xử lý yêu cầu.");return;}
      router.refresh();
    }catch{setError("Không có kết nối. Vui lòng tải lại và kiểm tra trạng thái.");}
    finally{setBusy(false)}
  }
  return <div className="space-y-3">
    <div className="flex flex-wrap gap-2">
      {canConfirm && <>
        <button disabled={busy} onClick={()=>decide("confirm")}
          className="rounded-xl bg-primary px-4 py-3 text-sm text-primary-foreground disabled:opacity-50">
          Xác nhận đã thanh toán
        </button>
        <button disabled={busy} onClick={()=>decide("reject")}
          className="rounded-xl border px-4 py-3 text-sm disabled:opacity-50">
          Từ chối
        </button>
      </>}
      {canCancel && <button disabled={busy} onClick={()=>decide("cancel")}
        className="rounded-xl border border-destructive px-4 py-3 text-sm text-destructive disabled:opacity-50">
        Hủy yêu cầu
      </button>}
    </div>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </div>;
}
