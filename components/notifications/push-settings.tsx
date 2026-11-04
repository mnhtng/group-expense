"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  pushFailureMessage, pushSupportReason, type PushEnvironment,
} from "@/lib/notifications/push-support";

type PushConfig = {
  configured: boolean;
  publicKey: string | null;
  enabled: boolean;
  devices: number;
};
type PushStatus = NotificationPermission | "unavailable";

function keyBytes(value: string): ArrayBuffer {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const text = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
  return bytes.buffer;
}

function detectEnvironment(): PushEnvironment {
  const nav = navigator as Navigator & {
    standalone?: boolean;
    brave?: { isBrave?: () => Promise<boolean> };
  };
  const ios = /iPhone|iPad|iPod/i.test(nav.userAgent) ||
    (nav.platform === "MacIntel" && nav.maxTouchPoints > 1);
  return {
    secure: window.isSecureContext,
    serviceWorker: "serviceWorker" in navigator,
    pushManager: "PushManager" in window,
    notification: "Notification" in window,
    ios,
    standalone: window.matchMedia("(display-mode: standalone)").matches ||
      nav.standalone === true,
    brave: /Brave/i.test(nav.userAgent) || Boolean(nav.brave),
  };
}

function currentPermission(): PushStatus {
  return typeof Notification === "undefined" ? "unavailable" : Notification.permission;
}

export function PushSettings() {
  const [config, setConfig] = useState<PushConfig | null>(null);
  const [environment, setEnvironment] = useState<PushEnvironment | null>(null);
  const [permission, setPermission] = useState<PushStatus>("unavailable");
  const [subscribed, setSubscribed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [workerReady, setWorkerReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [hint, setHint] = useState("");
  const registrationRef = useRef<ServiceWorkerRegistration | null>(null);
  const subscriptionRef = useRef<PushSubscription | null>(null);

  const refresh = useCallback(async () => {
    const env = detectEnvironment();
    setEnvironment(env);
    setPermission(currentPermission());
    setLoading(true);
    setError("");
    try {
      // "isBrave" is a privacy-friendly browser identification API, when available.
      const nav = navigator as Navigator & { brave?: { isBrave?: () => Promise<boolean> } };
      if (nav.brave?.isBrave) {
        try {
          if (await nav.brave.isBrave()) setEnvironment({ ...env, brave: true });
        } catch { /* Browser feature detection must not block push. */ }
      }

      const response = await fetch("/api/push/subscriptions", { cache: "no-store" });
      if (!response.ok) throw Error("Không tải được cấu hình thông báo.");
      const nextConfig = await response.json() as PushConfig;
      setConfig(nextConfig);

      if (pushSupportReason(env) !== null || !nextConfig.configured) {
        registrationRef.current = null;
        subscriptionRef.current = null;
        setWorkerReady(false);
        setSubscribed(false);
        return;
      }

      // Prepare the active worker BEFORE the user presses the button. iOS WebKit
      // requires subscribe() to run immediately in the user's tap handler.
      await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      const registration = await navigator.serviceWorker.ready;
      registrationRef.current = registration;
      setWorkerReady(true);

      const subscription = await registration.pushManager.getSubscription();
      subscriptionRef.current = subscription;
      if (!subscription || currentPermission() !== "granted") {
        setSubscribed(false);
        return;
      }

      // Browser subscription != successfully saved on our server.
      const checked = await fetch("/api/push/subscriptions/check", {
        method: "POST",
        cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ endpoint: subscription.endpoint }),
      });
      if (!checked.ok) throw Error("Không xác minh được đăng ký thiết bị trên máy chủ.");
      const result = await checked.json() as { saved: boolean };
      setSubscribed(result.saved);
    } catch (cause) {
      setSubscribed(false);
      setError(cause instanceof Error ? cause.message : "Không kiểm tra được Web Push.");
    } finally {
      setPermission(currentPermission());
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    // The user may change permission in iOS Settings while this PWA is paused.
    const onResume = () => { if (!document.hidden) void refresh(); };
    document.addEventListener("visibilitychange", onResume);
    window.addEventListener("focus", onResume);
    return () => {
      document.removeEventListener("visibilitychange", onResume);
      window.removeEventListener("focus", onResume);
    };
  }, [refresh]);

  async function enable() {
    const env = environment;
    const configNow = config;
    const registration = registrationRef.current;
    if (!env || pushSupportReason(env) !== null || !configNow?.configured ||
      !configNow.publicKey || !registration || busy) return;

    setBusy(true);
    setError("");
    setHint("");
    try {
      // iOS requires a direct user gesture for BOTH permission and subscription.
      // Keep them in separate taps if permission was not already granted.
      const present = currentPermission();
      if (present === "denied") {
        setPermission("denied");
        return;
      }
      if (present === "default") {
        // RequestPermission() is called immediately from the actual tap.
        const permissionPromise = Notification.requestPermission();
        const granted = await permissionPromise;
        setPermission(granted);
        if (granted === "granted") {
          setHint("Đã cấp quyền. Nhấn “Hoàn tất bật thông báo” để đăng ký thiết bị.");
        } else if (granted === "default") {
          setHint("Bạn chưa chọn cấp quyền. Nhấn lại khi muốn bật thông báo.");
        }
        return;
      }

      const saved = subscriptionRef.current;
      let subscription: PushSubscription;
      if (saved) {
        const currentKey = saved.options.applicationServerKey;
        const expected = new Uint8Array(keyBytes(configNow.publicKey));
        const actual = currentKey ? new Uint8Array(currentKey) : null;
        const matches = actual?.length === expected.length &&
          actual.every((value, index) => value === expected[index]);
        if (!matches) {
          // An old VAPID key cannot be reused. Do not subscribe after an await:
          // Safari may consider the original user activation already consumed.
          await saved.unsubscribe();
          subscriptionRef.current = null;
          setSubscribed(false);
          setHint("Đã làm mới đăng ký cũ. Nhấn “Hoàn tất bật thông báo” lần nữa.");
          return;
        }
        subscription = saved;
      } else {
        // CRITICAL: subscribe must be invoked before ANY await in this branch,
        // while the click's user activation is still valid on iOS WebKit.
        const pending = registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: keyBytes(configNow.publicKey),
        });
        subscription = await pending;
        subscriptionRef.current = subscription;
      }

      const response = await fetch("/api/push/subscriptions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(subscription.toJSON()),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null) as {error?:string} | null;
        throw Error(body?.error ?? "Không lưu được đăng ký thiết bị.");
      }
      const preference = await fetch("/api/push/subscriptions", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: true }),
      });
      if (!preference.ok) throw Error("Không thể bật thông báo trên máy chủ.");
      setHint("Thông báo đã được bật cho thiết bị này.");
      await refresh();
    } catch (cause) {
      setPermission(currentPermission());
      setError(pushFailureMessage(cause, env));
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    setError("");
    setHint("");
    try {
      const subscription = subscriptionRef.current;
      if (subscription) {
        const response = await fetch("/api/push/subscriptions", {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        });
        if (!response.ok) throw Error("Không thể hủy đăng ký trên máy chủ.");
        await subscription.unsubscribe();
        subscriptionRef.current = null;
      }
      setSubscribed(false);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không thể tắt thông báo.");
    } finally {
      setBusy(false);
    }
  }

  const reason = environment ? pushSupportReason(environment) : null;
  const canSubscribe = environment && reason === null && config?.configured && workerReady;
  const denied = permission === "denied";

  return <section className="space-y-3 rounded-2xl border bg-card p-4">
    <h2 className="text-lg font-semibold">Thông báo đẩy</h2>
    {loading && <p className="text-sm text-muted-foreground">Đang kiểm tra thông báo...</p>}

    {!loading && reason === "ios-install" && <div className="space-y-2 text-sm text-muted-foreground">
      <p>Trên iPhone, thông báo chỉ hoạt động khi mở web từ biểu tượng PWA trên Màn hình chính.</p>
      <p>Mở trang trong Safari → Chia sẻ → Thêm vào Màn hình chính → bật “Mở dưới dạng ứng dụng web” → mở từ biểu tượng mới.</p>
    </div>}
    {!loading && reason === "ios-upgrade" && <p className="text-sm text-muted-foreground">
      Web Push cần iOS 16.4 trở lên và ứng dụng được mở từ Màn hình chính. Hãy cập nhật iOS rồi mở lại PWA.
    </p>}
    {!loading && reason === "https-required" && <p className="text-sm text-muted-foreground">
      Thông báo đẩy cần kết nối HTTPS an toàn.
    </p>}
    {!loading && reason === "unsupported" && <p className="text-sm text-muted-foreground">
      Trình duyệt này chưa cung cấp đầy đủ Web Push. Bạn vẫn nhận được thông báo trong ứng dụng.
    </p>}
    {!loading && !reason && config && !config.configured &&
      <p className="text-sm text-muted-foreground">Web Push chưa được cấu hình trên máy chủ.</p>}

    {!loading && !reason && config?.configured && <>
      {denied ? <div className="space-y-2 text-sm">
        <p className="font-medium">Quyền thông báo đang bị từ chối hoặc bị chặn.</p>
        {environment?.ios ? <>
          <p className="text-muted-foreground">
            Mở Cài đặt iPhone → Thông báo → Group Expense → bật “Cho phép thông báo”.
            Bạn cũng có thể tìm trong Cài đặt → Ứng dụng → Group Expense → Thông báo.
          </p>
          <p className="text-muted-foreground">
            Nếu không thấy Group Expense trong danh sách, hãy mở lại PWA từ Màn hình chính và kiểm tra quyền lần nữa.
          </p>
        </> : <p className="text-muted-foreground">
          Bật quyền thông báo cho website trong cài đặt trình duyệt rồi kiểm tra lại.
        </p>}
        <button type="button" onClick={() => void refresh()} disabled={busy}
          className="min-h-11 rounded-xl border px-4 py-2 text-sm font-medium disabled:opacity-50">
          Kiểm tra lại quyền
        </button>
      </div> : <div className="space-y-2">
        <p className="text-sm">
          {subscribed ? "Đã bật trên thiết bị này"
            : permission === "default" ? "Chưa cấp quyền thông báo"
            : "Đã có quyền; chưa đăng ký thiết bị"}
        </p>
        {subscribed ? <button type="button" disabled={busy}
          onClick={() => void disable()}
          className="min-h-11 rounded-xl border px-4 py-3 text-sm disabled:opacity-50">
          Tắt thông báo
        </button> : <button type="button" disabled={busy || !canSubscribe}
          onClick={() => void enable()}
          className="min-h-11 rounded-xl bg-primary px-4 py-3 text-sm text-primary-foreground disabled:opacity-50">
          {busy ? "Đang xử lý..." : permission === "granted"
            ? "Hoàn tất bật thông báo" : "Cho phép thông báo"}
        </button>}
        {!workerReady && <p className="text-xs text-muted-foreground">
          Đang chuẩn bị dịch vụ thông báo...
        </p>}
      </div>}
      <p className="text-xs text-muted-foreground">Thiết bị đã đăng ký: {config.devices}</p>
    </>}

    {!loading && environment?.brave && reason === null &&
      <p className="text-xs text-muted-foreground">
        Brave: nếu đăng ký thất bại, hãy kiểm tra tùy chọn “Use Google services for push messaging”
        trong brave://settings/privacy. Khởi động lại Brave sau khi thay đổi.
      </p>}
    {hint && <p role="status" className="text-sm text-muted-foreground">{hint}</p>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </section>;
}
