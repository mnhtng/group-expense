"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { InlineConfirmation } from "@/components/ui/inline-confirmation";

type Action="confirm"|"reject"|"cancel";
const labels:Record<Action,{title:string;description:string;confirm:string}>={
  confirm:{
    title:"Xác nhận đã thanh toán?",
    description:"Chỉ xác nhận khi đã thực sự chuyển hoặc nhận tiền.",
    confirm:"Xác nhận",
  },
  reject:{
    title:"Từ chối yêu cầu thanh toán?",
    description:"Yêu cầu bị từ chối. Công nợ không thay đổi.",
    confirm:"Từ chối yêu cầu",
  },
  cancel:{
    title:"Hủy yêu cầu thanh toán?",
    description:"Yêu cầu bị hủy. Công nợ không thay đổi.",
    confirm:"Hủy yêu cầu",
  },
};
export function SettlementActions({groupId,settlementId,canConfirm,canCancel}:{
  groupId:string;settlementId:string;canConfirm:boolean;canCancel:boolean;
}){
  const router=useRouter();
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [confirmation,setConfirmation]=useState<Action|null>(null);
  const [note,setNote]=useState("");
  async function decide(action:Action){
    if(busy)return;
    setBusy(true);setError("");
    try{
      const res=await fetch(`/api/groups/${groupId}/settlements/${settlementId}`,{
        method:"PATCH",headers:{"Content-Type":"application/json"},
        credentials:"same-origin",cache:"no-store",body:JSON.stringify({action,note}),
      });
      if(!res.ok){
        const data=await res.json();
        setError(data.error??"Không thể xử lý yêu cầu.");
        router.refresh(); // Reconcile a possibly stale financial state.
        return;
      }
      setConfirmation(null);setNote("");
      router.refresh(); // Intentional update after server-confirmed state change.
    }catch{setError("Không có kết nối. Vui lòng tải lại và kiểm tra trạng thái.");}
    finally{setBusy(false)}
  }
  return <section className="space-y-3">
    <div className="flex flex-wrap gap-2">
      {canConfirm&&<>
        <button type="button" disabled={busy} onClick={()=>{setError("");setConfirmation("confirm");}}
          className="min-h-11 rounded-xl bg-primary px-4 py-3 text-sm text-primary-foreground disabled:opacity-50">
          Xác nhận đã thanh toán
        </button>
        <button type="button" disabled={busy} onClick={()=>{setError("");setConfirmation("reject");}}
          className="min-h-11 rounded-xl border px-4 py-3 text-sm disabled:opacity-50">
          Từ chối
        </button>
      </>}
      {canCancel&&<button type="button" disabled={busy}
        onClick={()=>{setError("");setConfirmation("cancel");}}
        className="min-h-11 rounded-xl border border-destructive px-4 py-3 text-sm text-destructive disabled:opacity-50">
        Hủy yêu cầu
      </button>}
    </div>
    {confirmation&&<InlineConfirmation title={labels[confirmation].title}
      description={labels[confirmation].description}
      confirmLabel={labels[confirmation].confirm}
      danger={confirmation!=="confirm"} busy={busy}
      note={note} onNoteChange={setNote} noteMaxLength={500}
      onCancel={()=>{setConfirmation(null);setError("");setNote("");}}
      onConfirm={()=>void decide(confirmation)}/>}
    {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
  </section>;
}
