"use client";

import { useCallback, useEffect, useState } from "react";
import {
  pushFailureMessage, pushSupportReason, type PushEnvironment,
} from "@/lib/notifications/push-support";

type PushConfig = {
  configured: boolean;
  publicKey: string | null;
  enabled: boolean;
  devices: number;
};

function keyBytes(value: string): ArrayBuffer {
  const base64=value.replace(/-/g,"+").replace(/_/g,"/");
  const decoded=atob(base64.padEnd(Math.ceil(base64.length/4)*4,"="));
  const bytes=new Uint8Array(decoded.length);
  for(let index=0;index<decoded.length;index++)bytes[index]=decoded.charCodeAt(index);
  if(bytes.length!==65||bytes[0]!==4)throw Error("Khóa Web Push không hợp lệ. Hãy kiểm tra cấu hình VAPID.");
  return bytes.buffer;
}

function browserEnvironment(): PushEnvironment {
  const isIos=/iPad|iPhone|iPod/i.test(navigator.userAgent) ||
    (navigator.platform==="MacIntel" && navigator.maxTouchPoints>1);
  const isStandalone=window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & {standalone?:boolean}).standalone===true;
  return {
    secure:window.isSecureContext,
    serviceWorker:"serviceWorker" in navigator,
    pushManager:"PushManager" in window,
    notification:"Notification" in window,
    ios:isIos,
    standalone:isStandalone,
    brave:false,
  };
}

export function PushSettings() {
  const [config,setConfig]=useState<PushConfig|null>(null);
  const [environment,setEnvironment]=useState<PushEnvironment|null>(null);
  const [subscribed,setSubscribed]=useState(false);
  const [busy,setBusy]=useState(false);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");

  const refresh=useCallback(async()=>{
    try {
      const response=await fetch("/api/push/subscriptions",{
        cache:"no-store",credentials:"same-origin",
      });
      if(!response.ok)throw Error("Không tải được cấu hình thông báo.");
      const nextConfig:PushConfig=await response.json();
      setConfig(nextConfig);

      // A browser subscription is not proof that the server saved it.
      let active=false;
      if("serviceWorker" in navigator && "PushManager" in window) {
        const registration=await navigator.serviceWorker.getRegistration("/");
        const local=await registration?.pushManager.getSubscription();
        if(local) {
          const check=await fetch("/api/push/subscriptions/check",{
            method:"POST",credentials:"same-origin",cache:"no-store",
            headers:{"content-type":"application/json"},
            body:JSON.stringify({endpoint:local.endpoint}),
          });
          if(!check.ok)throw Error("Không kiểm tra được đăng ký Push trên máy chủ.");
          const status:{saved:boolean}=await check.json();
          active=Boolean(status.saved && nextConfig.enabled);
        }
      }
      setSubscribed(active);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error?cause.message:"Không tải được cấu hình thông báo.");
    } finally {
      setLoading(false);
    }
  },[]);

  useEffect(()=>{
    let cancelled=false;
    queueMicrotask(()=>{
      if(cancelled)return;
      setEnvironment(browserEnvironment());
      void refresh();
      const brave=(navigator as Navigator & {
        brave?:{isBrave?:()=>Promise<boolean>}
      }).brave;
      if(brave?.isBrave) {
        void brave.isBrave().then(isBrave=>{
          if(!cancelled&&isBrave)setEnvironment(previous=>previous?{...previous,brave:true}:previous);
        }).catch(()=>{});
      }
    });
    return ()=>{cancelled=true;};
  },[refresh]);

  const reason=environment?pushSupportReason(environment):"unsupported";
  const permissionDenied=environment?.notification &&
    typeof Notification!=="undefined" && Notification.permission==="denied";

  async function enable() {
    if(busy || reason!==null || !config?.configured || !config.publicKey || permissionDenied)return;
    setBusy(true);
    setError("");
    try {
      const publicKey=keyBytes(config.publicKey);
      // Keep permission prompting directly inside the user's click.
      const permission=await Notification.requestPermission();
      if(permission!=="granted") {
        throw new DOMException("Notification permission denied","NotAllowedError");
      }
      const registration=await navigator.serviceWorker.register("/sw.js",{scope:"/"});
      const worker=await navigator.serviceWorker.ready;
      if(registration.scope!==worker.scope) {
        throw Error("Service Worker chưa sẵn sàng. Hãy tải lại trang và thử lại.");
      }
      let subscription=await worker.pushManager.getSubscription();
      // VAPID keys may change between preview environments. Do not keep
      // a subscription whose applicationServerKey differs from the server key.
      if(subscription?.options.applicationServerKey) {
        const current=new Uint8Array(subscription.options.applicationServerKey);
        const expected=new Uint8Array(publicKey);
        if(current.length!==expected.length||current.some((b,i)=>b!==expected[i])) {
          await subscription.unsubscribe();
          subscription=null;
        }
      }
      subscription??=await worker.pushManager.subscribe({
        userVisibleOnly:true,
        applicationServerKey:publicKey,
      });
      const saved=await fetch("/api/push/subscriptions",{
        method:"POST",credentials:"same-origin",cache:"no-store",
        headers:{"content-type":"application/json"},
        body:JSON.stringify(subscription),
      });
      if(!saved.ok) {
        const data:unknown=await saved.json().catch(()=>null);
        const message=data&&typeof data==="object"&&"error" in data &&
          typeof (data as {error:unknown}).error==="string"
          ? (data as {error:string}).error : "Không lưu được thiết bị nhận Push.";
        throw Error(message);
      }
      const preference=await fetch("/api/push/subscriptions",{
        method:"PATCH",credentials:"same-origin",cache:"no-store",
        headers:{"content-type":"application/json"},
        body:JSON.stringify({enabled:true}),
      });
      if(!preference.ok)throw Error("Không thể bật thông báo cho tài khoản.");
      await refresh();
    } catch(cause) {
      setError(pushFailureMessage(cause,environment??{brave:false}));
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    if(busy)return;
    setBusy(true);
    setError("");
    try {
      const registration=await navigator.serviceWorker.getRegistration("/");
      const subscription=await registration?.pushManager.getSubscription();
      if(subscription) {
        const response=await fetch("/api/push/subscriptions",{
          method:"DELETE",credentials:"same-origin",cache:"no-store",
          headers:{"content-type":"application/json"},
          body:JSON.stringify({endpoint:subscription.endpoint}),
        });
        if(!response.ok)throw Error("Không thể bỏ đăng ký thiết bị trên máy chủ.");
        await subscription.unsubscribe();
      }
      await refresh();
    } catch(cause) {
      setError(pushFailureMessage(cause,environment??{brave:false}));
    } finally {
      setBusy(false);
    }
  }

  return <section className="space-y-3 rounded-2xl border bg-card p-4">
    <h2 className="text-lg font-semibold">Thông báo đẩy</h2>
    {environment===null || loading
      ? <p role="status" className="text-sm text-muted-foreground">Đang kiểm tra thiết bị...</p>
      : null}
    {environment && reason==="ios-install" && <div className="space-y-2 text-sm">
      <p>iPhone/iPad chỉ nhận Web Push khi mở ứng dụng từ Màn hình chính (iOS 16.4 trở lên).</p>
      <p className="text-muted-foreground">
        Trong Safari: nhấn <strong>Chia sẻ</strong> → <strong>Thêm vào Màn hình chính</strong>.
        Sau đó mở Group Expense bằng biểu tượng trên Màn hình chính và chọn <strong>Bật thông báo</strong>.
      </p>
    </div>}
    {environment && reason==="ios-upgrade" && <p className="text-sm text-muted-foreground">
      Thiết bị chưa có các API Web Push cần thiết. Hãy dùng iOS/iPadOS 16.4 trở lên,
      mở Group Expense từ biểu tượng ở Màn hình chính rồi thử lại.
    </p>}
    {environment && reason==="https-required" && <p className="text-sm text-muted-foreground">
      Web Push cần kết nối HTTPS an toàn.
    </p>}
    {environment && reason==="unsupported" && <p className="text-sm text-muted-foreground">
      Trình duyệt hoặc chế độ duyệt web hiện tại chưa cung cấp Web Push.
    </p>}
    {environment && reason===null && config?.configured===false &&
      <p className="text-sm text-muted-foreground">Máy chủ chưa cấu hình Web Push (VAPID).</p>}
    {environment && reason===null && config?.configured && <div className="space-y-2">
      <p className="text-sm">{subscribed?"Đã bật trên thiết bị này":"Chưa bật trên thiết bị này"}</p>
      {permissionDenied
        ? <p className="text-sm text-muted-foreground">
          Bạn đã chặn quyền thông báo. Hãy cho phép trang này gửi thông báo trong cài đặt
          trình duyệt hoặc hệ điều hành, rồi tải lại trang.
        </p>
        : subscribed
          ? <button disabled={busy} type="button" onClick={()=>void disable()}
              className="min-h-11 rounded-xl border px-4 py-3 text-sm disabled:opacity-50">
              {busy?"Đang xử lý...":"Tắt thông báo"}
            </button>
          : <button disabled={busy} type="button" onClick={()=>void enable()}
              className="min-h-11 rounded-xl bg-primary px-4 py-3 text-sm text-primary-foreground disabled:opacity-50">
              {busy?"Đang xử lý...":"Bật thông báo"}
            </button>}
      {environment.brave && !subscribed && <p className="text-xs text-muted-foreground">
        Brave: nếu không đăng ký được Push, mở <code>brave://settings/privacy</code>,
        bật <strong>Use Google services for push messaging</strong> rồi khởi động lại Brave.
      </p>}
      <p className="text-xs text-muted-foreground">Thiết bị đã đăng ký: {config.devices}</p>
    </div>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <p className="text-xs text-muted-foreground">
      Thông báo trong ứng dụng vẫn hoạt động ngay cả khi bạn không bật Web Push.
    </p>
  </section>;
}
