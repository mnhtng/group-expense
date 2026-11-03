"use client";
import { useCallback, useEffect, useState } from "react";

type PushConfig={configured:boolean;publicKey:string|null;enabled:boolean;devices:number};
function keyBytes(value:string):ArrayBuffer{
  const base64=value.replace(/-/g,"+").replace(/_/g,"/");
  const str=atob(base64.padEnd(Math.ceil(base64.length/4)*4,"="));
  const bytes=new Uint8Array(str.length);
  for(let i=0;i<str.length;i++)bytes[i]=str.charCodeAt(i);
  return bytes.buffer;
}
export function PushSettings(){
  const [config,setConfig]=useState<PushConfig|null>(null);
  const [subscribed,setSubscribed]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const supported=typeof window!=="undefined" && "serviceWorker" in navigator &&
    "PushManager" in window && "Notification" in window && window.isSecureContext;
  const refresh=useCallback(async()=>{
    try{
      const r=await fetch("/api/push/subscriptions",{cache:"no-store"});
      if(!r.ok)throw Error("Không tải được cấu hình thông báo.");
      setConfig(await r.json());
      if("serviceWorker" in navigator){
        const reg=await navigator.serviceWorker.getRegistration("/");
        setSubscribed(Boolean(reg && await reg.pushManager.getSubscription()));
      }
    }catch{setError("Không tải được cấu hình thông báo.");}
  },[]);
  useEffect(()=>{queueMicrotask(()=>{void refresh();});},[refresh]);
  async function enable(){
    if(!supported||!config?.configured||!config.publicKey)return;
    setBusy(true);setError("");
    try{
      const permission=await Notification.requestPermission();
      if(permission!=="granted")throw Error("Trình duyệt chưa được cấp quyền thông báo.");
      const registration=await navigator.serviceWorker.register("/sw.js");
      const existing=await registration.pushManager.getSubscription();
      const subscription=existing??await registration.pushManager.subscribe({
        userVisibleOnly:true,applicationServerKey:keyBytes(config.publicKey),
      });
      const res=await fetch("/api/push/subscriptions",{
        method:"POST",headers:{"content-type":"application/json"},
        body:JSON.stringify(subscription),
      });
      if(!res.ok){const d=await res.json();throw Error(d.error??"Không lưu được thiết bị.");}
      const preference=await fetch("/api/push/subscriptions",{
        method:"PATCH",headers:{"content-type":"application/json"},
        body:JSON.stringify({enabled:true}),
      });
      if(!preference.ok)throw Error("Không thể bật thông báo.");
      await refresh();
    }catch(e){setError(e instanceof Error?e.message:"Không thể bật thông báo.");}
    finally{setBusy(false);}
  }
  async function disable(){
    setBusy(true);setError("");
    try {
      const registration=await navigator.serviceWorker.getRegistration("/");
      const subscription=await registration?.pushManager.getSubscription();
      if(subscription){
        const res=await fetch("/api/push/subscriptions",{
          method:"DELETE",headers:{"content-type":"application/json"},
          body:JSON.stringify({endpoint:subscription.endpoint}),
        });
        if(!res.ok)throw Error("Không thể bỏ đăng ký trên máy chủ.");
        await subscription.unsubscribe();
      }
      await refresh();
    }catch(e){setError(e instanceof Error?e.message:"Không thể tắt thông báo.");}
    finally{setBusy(false)}
  }
  return <section className="space-y-3 rounded-2xl border bg-card p-4">
    <h2 className="text-lg font-semibold">Thông báo trình duyệt</h2>
    <p className="text-sm text-muted-foreground">
      Thông báo in-app luôn sẵn có. Web Push chỉ gửi đến thiết bị đã chủ động đăng ký.
    </p>
    {!supported&&<p className="text-sm text-muted-foreground">
      Trình duyệt này không hỗ trợ Web Push hoặc trang chưa dùng HTTPS. Trên iPhone, hãy thêm PWA vào Màn hình chính rồi bật quyền thông báo.
    </p>}
    {supported&&!config?.configured&&<p className="text-sm text-muted-foreground">
      Máy chủ chưa cấu hình VAPID; vẫn có thể xem thông báo trong ứng dụng.
    </p>}
    {config?.configured&&supported&&<div className="space-y-2">
      <p className="text-sm">{subscribed?"Thiết bị này đã bật Web Push":"Thiết bị này chưa bật Web Push"}</p>
      {subscribed?<button disabled={busy} type="button" onClick={()=>void disable()}
        className="rounded-xl border px-4 py-3 text-sm disabled:opacity-50">Tắt thông báo trên thiết bị</button>
        :<button disabled={busy} type="button" onClick={()=>void enable()}
          className="rounded-xl bg-primary px-4 py-3 text-sm text-primary-foreground disabled:opacity-50">
          Bật thông báo trên thiết bị
        </button>}
      <p className="text-xs text-muted-foreground">Số thiết bị đã đăng ký trên tài khoản: {config.devices}.</p>
    </div>}
    {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
  </section>;
}
