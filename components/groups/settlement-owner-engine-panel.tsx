"use client";

import {useState} from "react";
import {useRouter} from "next/navigation";
import type {OwnerEngineActivationView} from "@/lib/settlement-cycles/owner-activation";

/** Visible exclusively to the owner; the authenticated API checks ownership again. */
export function SettlementOwnerEnginePanel({groupId,initial,requestedEnabled}:{
  groupId:string;initial:OwnerEngineActivationView;requestedEnabled:boolean;
}){
  const router=useRouter();
  const [view,setView]=useState(initial);
  const [intent,setIntent]=useState<boolean|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [info,setInfo]=useState("");

  const active=view.enabled&&requestedEnabled&&!view.emergencyPaused;
  const canEnable=requestedEnabled&&!view.enabled;
  const canDisable=view.enabled;
  async function change(enabled:boolean){
    if(busy)return;
    setBusy(true);setError("");setInfo("");
    try{
      const response=await fetch(`/api/groups/${groupId}/settlement-cycle/owner-activation`,{
        method:"PATCH",credentials:"same-origin",cache:"no-store",
        headers:{"content-type":"application/json"},
        body:JSON.stringify({
          enabled,expectedEnabled:view.enabled,
          expectedSettingsVersion:view.settingsVersion,
        }),
      });
      const data:unknown=await response.json().catch(()=>null);
      if(!response.ok)throw Error(data&&typeof data==="object"&&"error" in data&&
        typeof (data as {error:unknown}).error==="string"
        ?(data as {error:string}).error:"Không thể thay đổi trạng thái thanh toán.");
      setView(data as OwnerEngineActivationView);
      setIntent(null);
      setInfo(enabled?"Đã bật thanh toán theo kỳ cho nhóm.":"Đã tắt thanh toán theo kỳ cho nhóm.");
      router.refresh();
    }catch(cause){
      setError(cause instanceof Error?cause.message:"Lỗi kết nối. Vui lòng tải lại trang.");
      router.refresh();
    }finally{setBusy(false);}
  }

  return <section aria-labelledby="owner-settlement-finance"
    className="space-y-3 rounded-3xl border bg-card p-5">
    <div className="space-y-1">
      <h2 id="owner-settlement-finance" className="text-base font-semibold">
        Financial Engine của nhóm
      </h2>
      <p className="text-sm text-muted-foreground">
        Chỉ chủ nhóm được bật hoặc tắt bù nợ và thanh toán theo kỳ.
        Việc tắt không xóa các giao dịch đã hoàn tất.
      </p>
    </div>
    <div className="rounded-xl bg-secondary p-3 text-sm">
      <p className="font-medium">
        {active?"Thanh toán đang hoạt động":view.enabled?
          "Đã bật cho nhóm — hệ thống đang tạm dừng":"Thanh toán theo kỳ đang tắt"}
      </p>
      {view.emergencyPaused&&<p className="mt-1 text-muted-foreground">
        Hệ thống đang tạm dừng giao dịch tài chính để bảo vệ dữ liệu.
        Chủ nhóm vẫn có thể tắt quyền của nhóm, nhưng không thể bỏ qua tạm dừng khẩn cấp.
      </p>}
      {!requestedEnabled&&<p className="mt-1 text-muted-foreground">
        Hãy bật và lưu Quyết toán ở phía trên trước khi mở thanh toán cho nhóm.
      </p>}
    </div>
    {view.enabled?
      <button type="button" disabled={busy||!canDisable}
        onClick={()=>setIntent(false)}
        className="min-h-11 rounded-xl border px-4 text-sm font-medium disabled:opacity-50">
        Tắt Financial Engine của nhóm
      </button>
      :<button type="button" disabled={busy||!canEnable}
        onClick={()=>setIntent(true)}
        className="min-h-11 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50">
        Bật Financial Engine cho nhóm
      </button>}
    {intent!==null&&<div role="group" aria-label="Xác nhận thay đổi quyền thanh toán"
      className="space-y-2 rounded-xl border p-3">
      <p className="text-sm">
        {intent?
          "Bật thanh toán theo kỳ cho nhóm này? Giao dịch vẫn yêu cầu xác nhận của các bên và phải tuân thủ giới hạn số dư.":
          "Tắt tạo giao dịch tài chính mới cho nhóm này? Các khoản đã xác nhận và lịch sử không bị xóa."}
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy} onClick={()=>void change(intent)}
          className="min-h-11 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50">
          {busy?"Đang lưu...":"Xác nhận"}
        </button>
        <button type="button" disabled={busy} onClick={()=>setIntent(null)}
          className="min-h-11 rounded-xl border px-4 text-sm">Hủy</button>
      </div>
    </div>}
    {info&&<p role="status" className="text-sm text-muted-foreground">{info}</p>}
    {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
  </section>;
}
