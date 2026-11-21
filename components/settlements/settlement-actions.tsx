"use client";
import {useRouter} from "next/navigation";
import {useState} from "react";

/** The initiator already cast the first acknowledgement.
 * Only the real other counterparty may approve/reject in one tap.
 * POST/PATCH still re-authorizes and locks every write in PostgreSQL.
 */
export function SettlementActions({groupId,settlementId,canConfirm,canCancel,
  actorRole}:{groupId:string;settlementId:string;canConfirm:boolean;
  canCancel:boolean;actorRole:"debtor"|"creditor";
}){
  const router=useRouter();
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [feedback,setFeedback]=useState("");
  const [note,setNote]=useState("");
  const [showNote,setShowNote]=useState(false);
  const confirmLabel=actorRole==="creditor"?"Xác nhận đã nhận":"Xác nhận đã trả";
  const run=async(action:"confirm"|"reject"|"cancel")=>{
    if(busy)return;
    setBusy(true);setError("");setFeedback("");
    try{
      const res=await fetch("/api/groups/"+groupId+"/settlements/"+settlementId,{
        method:"PATCH",headers:{"content-type":"application/json"},
        credentials:"same-origin",cache:"no-store",
        body:JSON.stringify({action,note}),
      });
      if(!res.ok){
        const result:unknown=await res.json().catch(()=>null);
        const msg=result&&typeof result==="object"&&"error" in result&&
          typeof result.error==="string"?result.error:"Không thể xử lý.";
        throw Error(msg);
      }
      setNote("");setShowNote(false);
      setFeedback(action==="confirm"?"Đã xác nhận thanh toán":
        action==="reject"?"Đã từ chối":"Đã hủy");
      router.refresh();
    }catch(e){
      setError(e instanceof Error?e.message:"Không có kết nối. Vui lòng kiểm tra và thử lại.");
      router.refresh();
    }finally{setBusy(false);}
  };
  return <section className="space-y-2">
    <div className="flex flex-wrap gap-2">
      {canConfirm&&<>
        <button type="button" disabled={busy} onClick={()=>void run("confirm")}
          title="Chỉ xác nhận khi đã thực sự chuyển hoặc nhận tiền."
          className="min-h-12 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50">
          {busy?"Đang xử lý…":confirmLabel}
        </button>
        <button type="button" disabled={busy} onClick={()=>void run("reject")}
          title="Từ chối yêu cầu: Công nợ không thay đổi."
          className="min-h-12 rounded-xl border px-4 text-sm font-semibold disabled:opacity-50">
          Từ chối
        </button>
      </>}
      {canCancel&&<button type="button" disabled={busy} onClick={()=>void run("cancel")}
        className="min-h-12 rounded-xl border px-4 text-sm disabled:opacity-50">
        Hủy
      </button>}
    </div>
    <button type="button" disabled={busy}
      className="min-h-11 text-sm text-muted-foreground underline underline-offset-4"
      onClick={()=>setShowNote(v=>!v)}>
      {showNote?"Ẩn ghi chú":"Thêm ghi chú"}
    </button>
    {showNote&&<label className="block space-y-2 text-sm">
      <span>Ghi chú (không bắt buộc)</span>
      <textarea value={note} onChange={e=>setNote(e.target.value)}
        maxLength={500} rows={2}
        className="w-full rounded-xl border bg-background p-3"/>
    </label>}
    {feedback&&<p role="status" className="text-sm text-money-in">{feedback}</p>}
    {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
  </section>;
}
