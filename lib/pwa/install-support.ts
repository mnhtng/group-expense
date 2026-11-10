type InstallEnvironment = {
  userAgent: string;
  platform: string;
  maxTouchPoints: number;
};

/** Manual guidance only. Native install availability comes from beforeinstallprompt. */
export function installGuide(env: InstallEnvironment): string | null {
  const ua = env.userAgent;
  const ios = /iPhone|iPad|iPod/i.test(ua) ||
    (env.platform === "MacIntel" && env.maxTouchPoints > 1);
  const android = /Android/i.test(ua);
  const embedded = /FBAN|FBAV|Instagram|Zalo|Line\/|; wv\)|WebView/i.test(ua);

  if (embedded && (ios || android)) {
    return ios
      ? "Mở menu của ứng dụng → Mở bằng Safari. Trong Safari, chọn Chia sẻ → Thêm vào Màn hình chính → Thêm. Nếu có, bật “Mở dưới dạng ứng dụng web”."
      : "Mở menu của ứng dụng → Mở bằng Chrome hoặc trình duyệt mặc định. Sau đó chọn cài ứng dụng hoặc thêm vào Màn hình chính trong menu trình duyệt.";
  }
  if (ios) {
    return "Trong Safari, mở Chia sẻ (có thể nằm trong menu trang) → Thêm vào Màn hình chính → Thêm. Nếu có, bật “Mở dưới dạng ứng dụng web”. Nếu đang dùng trình duyệt khác, hãy mở trang này trong Safari.";
  }

  const firefox = Number(ua.match(/Firefox\/(\d+)/i)?.[1] ?? 0);
  if (firefox && android) {
    return "Trong Firefox, mở menu ⋮ → Cài đặt (Install) → Thêm vào Màn hình chính. Chọn thêm tự động hoặc kéo biểu tượng đến vị trí bạn muốn.";
  }
  if (firefox >= 143 && /Windows NT/i.test(ua)) {
    return "Trong Firefox, bấm biểu tượng ứng dụng web trên thanh địa chỉ để thêm vào thanh tác vụ và menu Start. Nếu không thấy, hãy cập nhật Firefox và dùng cửa sổ thường; bản Microsoft Store cần Firefox 150 trở lên.";
  }

  const safari = Number(ua.match(/Version\/(\d+)/i)?.[1] ?? 0);
  if (safari >= 17 && /Macintosh/i.test(ua) && /Safari\//i.test(ua) &&
      !/Chrome|Chromium|Edg|OPR|Firefox/i.test(ua)) {
    return "Trên macOS Sonoma 14 trở lên, trong Safari chọn Tệp (File) → Thêm vào Dock (Add to Dock) → Thêm. Bạn cũng có thể tìm “Thêm vào Dock” trong menu Chia sẻ.";
  }
  return null;
}
