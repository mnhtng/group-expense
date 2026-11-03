import { requireUser } from "@/lib/auth/session";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { PushSettings } from "@/components/notifications/push-settings";
export default async function SettingsPage(){
  const user=await requireUser();
  return <main className="mx-auto max-w-lg space-y-5 px-5 py-8">
    <h1 className="text-2xl font-semibold">Cá nhân</h1>
    <p>{user.name}</p>
    <p className="text-sm text-muted-foreground">{user.email}</p>
    <PushSettings/>
    <SignOutButton/>
    <p className="text-sm text-muted-foreground">
      Phiên đăng nhập được gia hạn khi sử dụng. Đăng xuất sẽ ngắt đăng ký Web Push của thiết bị này;
      thông báo in-app vẫn giữ lại trong tài khoản.
    </p>
  </main>;
}
