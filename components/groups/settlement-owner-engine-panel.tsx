"use client";

import {useState} from "react";
import {useRouter} from "next/navigation";
import type {OwnerEngineActivationView} from "@/lib/settlement-cycles/owner-activation";

/** Only rendered for a current group owner. API/DAL independently recheck. */
export function SettlementOwnerEnginePanel({groupId,initial,requestedEnabled}:{
  groupId:string;initial:OwnerEngineActivationView;requestedEnabled:boolean;
}){
  const router=useRouter();
  const [view,setView]=useState(initial);
  const [intent,setIntent]=useState<boolean|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [info,setInfo]=useState("");

  const effective=view.globalEnabled&&view.admitted&&requestedEnabled;
  const canEnable=view.operatorConfigured&&requestedEnabled&&
    (view.admitted||view.admittedGroups<view.cohortLimit);
  const canDisable=view.operatorConfigured&&view.admitted;
  async function change(enabled:boolean){
    if(busy)return;
    setBusy(true);setError("");setInfo("");
    try{
      const response=await fetch(`/api/groups/${groupId}/settlement-cycle/owner-activation`,{
        method:"PATCH",credentials:"same-origin",cache:"no-store",
        headers:{"content-type":"application/json"},
        body:JSON.stringify({
          enabled,expectedAdmitted:view.admitted,
          expectedControlRevision:view.controlRevision,
        }),
      });
      const data:unknown=await response.json().catch(()=>null);
      if(!response.ok)throw Error(data&&typeof data==="object"&&"error" in data&&
        typeof (data as {error:unknown}).error==="string"
        ?(data as {error:string}).error:"Không thay đổi được quyền thanh toán.");
      setView(data as OwnerEngineActivationView);
      setIntent(null);
      setInfo(enabled?(view.globalEnabled?"Đã mở thanh toán cho nhóm.":"Đã đăng ký quyền cho nhóm. Hệ thống hiện đang tạm dừng."):"Đã thu hồi quyền của nhóm.");
      router.refresh();
    }catch(cause){
      setError(cause instanceof Error?cause.message:"Lỗi kết nối.");
      router.refresh();
    }finally{setBusy(false);}
  }

  return <section aria-labelledby="owner-settlement-finance"
    className="space-y-3 rounded-3xl border bg-card p-5">
    <div className="space-y-1">
      <h2 id="owner-settlement-finance" className="text-base font-semibold">
        Thanh toán theo kỳ
      </h2>
      <p className="text-sm text-muted-foreground">
        Chỉ chủ nhóm có thể cho phép nhóm sử dụng bù nợ và xác nhận thanh toán.
      </p>
    </div>
    <div className="rounded-xl bg-secondary p-3 text-sm">
      <p className="font-medium">{effective?"Đã mở cho nhóm":view.admitted?
        "Nhóm đã đăng ký, đang chờ hệ thống mở":"Chưa mở cho nhóm"}</p>
      {!view.globalEnabled&&<p className="mt-1 text-muted-foreground">
        Financial Engine toàn hệ thống đang tạm dừng. Chủ nhóm có thể đăng ký
        hoặc thu hồi quyền nhóm; giao dịch chỉ thực hiện khi hệ thống mở lại.
      </p>}
      {view.globalEnabled&&!view.admitted&&view.admittedGroups>=view.cohortLimit&&
        <p className="mt-1 text-muted-foreground">
          Đã đạt giới hạn nhóm được mở. Vui lòng liên hệ người vận hành.
        </p>}
      {!view.operatorConfigured&&<p className="mt-1 text-muted-foreground">
        Máy chủ chưa cấu hình quyền kích hoạt có giới hạn.
      </p>}
      {!requestedEnabled&&<p className="mt-1 text-muted-foreground">
        Hãy bật và lưu lựa chọn Quyết toán ở phía trên trước.
      </p>}
    </div>
    {view.admitted?
      <button type="button" disabled={busy||!canDisable}
        onClick={()=>setIntent(false)}
        className="min-h-11 rounded-xl border px-4 text-sm font-medium disabled:opacity-50">
        Thu hồi quyền thanh toán
      </button>
      :<button type="button" disabled={busy||!canEnable}
        onClick={()=>setIntent(true)}
        className="min-h-11 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50">
        {view.globalEnabled?"Mở thanh toán cho nhóm":"Đăng ký thanh toán cho nhóm"}
      </button>}
    {intent!==null&&<div role="group" aria-label="Xác nhận thay đổi quyền thanh toán"
      className="space-y-2 rounded-xl border p-3">
      <p className="text-sm">
        {intent?"Đăng ký quyền xử lý thanh toán cho nhóm này? Nếu hệ thống đang tạm dừng, nhóm sẽ chưa thể ghi giao dịch. Mọi đề xuất bù nợ vẫn cần hai bên xác nhận.":"Thu hồi quyền nhóm? Lịch sử tiền đã xác nhận vẫn được giữ nguyên."}
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy}
          onClick={()=>void change(intent)}
          className="min-h-11 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50">
          Xác nhận
        </button>
        <button type="button" disabled={busy} onClick={()=>setIntent(null)}
          className="min-h-11 rounded-xl border px-4 text-sm">Hủy</button>
      </div>
    </div>}
    {info&&<p role="status" className="text-sm text-muted-foreground">{info}</p>}
    {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
  </section>;
}
