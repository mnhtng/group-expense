"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { InlineConfirmation } from "@/components/ui/inline-confirmation";

export function RecurringRuleActions({groupId,ruleId,version,status}:{
  groupId:string;ruleId:string;version:number;status:"active"|"paused";
}) {
  const router=useRouter();
  const [action,setAction]=useState<"pause"|"resume"|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [message,setMessage]=useState("");
  const base=`/api/groups/${groupId}/recurring/${ruleId}`;
  async function submit(kind:"pause"|"resume"|"generate") {
    if(busy)return;
    setBusy(true);setError("");setMessage("");
    try{
      const response=await fetch(kind==="generate"?base+"/generate":base,{
        method:"POST",credentials:"same-origin",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify(kind==="generate"?{}:{
          expectedVersion:version,action:kind,
        }),
      });
      const data:unknown=await response.json().catch(()=>null);
      if(!response.ok)throw Error(data&&typeof data==="object"&&"error" in data &&
        typeof (data as {error:unknown}).error==="string"
          ? (data as {error:string}).error:"Không thực hiện được.");
      if(kind==="generate") {
        const generated=data && typeof data==="object" && "generated" in data
          ? Number((data as {generated:unknown}).generated):0;
        const paused=data && typeof data==="object" && "paused" in data
          ? Number((data as {paused:unknown}).paused):0;
        setMessage(paused>0
          ?"Mẫu đã tự tạm dừng vì danh sách người chia hoặc người trả tiền cần cập nhật."
          : generated>0 ? `Đã tạo ${generated} khoản chi kỳ đến hạn.`
          :"Chưa có kỳ nào đến hạn hoặc kỳ hiện tại đã được tạo.");
      } else setAction(null);
      router.refresh();
    } catch(cause) {
      setError(cause instanceof Error?cause.message:"Lỗi kết nối.");
    } finally {setBusy(false);}
  }
  return <div className="space-y-3">
    <div className="flex flex-wrap gap-2">
      {status==="active"&&<button type="button" disabled={busy}
        onClick={()=>void submit("generate")}
        className="min-h-11 rounded-xl bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">
        {busy?"Đang xử lý...":"Tạo kỳ đến hạn"}
      </button>}
      <button type="button" disabled={busy} onClick={()=>setAction(
        status==="active"?"pause":"resume")}
        className="min-h-11 rounded-xl border px-3 py-2 text-sm font-medium disabled:opacity-50">
        {status==="active"?"Tạm dừng":"Tiếp tục"}
      </button>
    </div>
    {action&&<InlineConfirmation
      title={action==="pause"?"Tạm dừng chi phí định kỳ?":"Tiếp tục chi phí định kỳ?"}
      description={action==="pause"
        ?"Hệ thống sẽ không tạo thêm khoản chi mới. Khoản chi các tháng cũ không thay đổi."
        :"Chỉ tạo các kỳ đến hạn từ hôm nay trở đi, không tự tạo bù các kỳ đã tạm dừng."}
      confirmLabel={action==="pause"?"Tạm dừng":"Tiếp tục"}
      busy={busy} onConfirm={()=>void submit(action)}
      onCancel={()=>setAction(null)}/>}
    {message&&<p role="status" className="text-xs text-muted-foreground">{message}</p>}
    {error&&<p role="alert" className="text-xs text-destructive">{error}</p>}
  </div>;
}
