import { requireUser } from "@/lib/auth/session";
import { SignOutButton } from "@/components/auth/sign-out-button";

export default async function SettingsPage() {
  const user = await requireUser();
  return <main className="mx-auto max-w-lg space-y-4 px-5 py-10">
    <h1 className="text-2xl font-semibold">Cá nhân</h1>
    <p>{user.name}</p><p className="text-sm text-muted-foreground">{user.email}</p>
    <SignOutButton />
    <p className="text-sm text-muted-foreground">Phiên đăng nhập được gia hạn khi sử dụng. Việc xóa cookie hoặc thu hồi phiên có thể yêu cầu đăng nhập lại.</p>
  </main>;
}
