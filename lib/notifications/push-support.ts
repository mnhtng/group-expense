/**
 * Push support is capability-driven. iOS Safari tabs intentionally differ
 * from iOS Home Screen web apps; Brave may expose PushManager with the
 * underlying push transport disabled by a privacy setting.
 */
export type PushEnvironment = {
  secure: boolean;
  serviceWorker: boolean;
  pushManager: boolean;
  notification: boolean;
  ios: boolean;
  standalone: boolean;
  brave: boolean;
};

export type PushSupportReason =
  | "ios-install" | "ios-upgrade" | "https-required" | "unsupported" | null;

export function pushSupportReason(env: PushEnvironment): PushSupportReason {
  if (env.ios && !env.standalone) return "ios-install";
  if (!env.secure) return "https-required";
  if (!env.serviceWorker || !env.pushManager || !env.notification) {
    return env.ios ? "ios-upgrade" : "unsupported";
  }
  return null;
}

export function pushFailureMessage(error: unknown, env: Pick<PushEnvironment, "brave">): string {
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : "";
  if (/push service error/i.test(message)) {
    return env.brave
      ? "Brave không kết nối được dịch vụ Push. Mở brave://settings/privacy, bật “Use Google services for push messaging”, khởi động lại Brave và thử lại."
      : "Trình duyệt không kết nối được dịch vụ Push. Kiểm tra kết nối mạng, cấu hình Push của trình duyệt rồi thử lại.";
  }
  if (name === "NotAllowedError" || /permission|denied|quyền thông báo/i.test(message)) {
    return "Quyền thông báo đã bị từ chối. Hãy cho phép thông báo trong cài đặt trình duyệt hoặc hệ điều hành, rồi thử lại.";
  }
  if (name === "AbortError" || name === "NetworkError") {
    return env.brave
      ? "Brave không tạo được đăng ký Push. Kiểm tra “Use Google services for push messaging” tại brave://settings/privacy, sau đó thử lại."
      : "Không kết nối được dịch vụ thông báo của trình duyệt. Kiểm tra mạng rồi thử lại.";
  }
  // Server errors in this application are localized by the API.
  if (message && !/registration failed|pushmanager|serviceworker/i.test(message)) return message;
  return "Không thể bật Web Push. Hãy tải lại trang, kiểm tra quyền thông báo rồi thử lại.";
}
