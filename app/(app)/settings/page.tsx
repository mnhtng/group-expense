import { requireUser } from "@/lib/auth/session";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { PushSettings } from "@/components/notifications/push-settings";
export default async function SettingsPage(){
  const user=await requireUser();
  return <main className="app-page space-y-5">
    <h1 className="text-2xl font-semibold">Cá nhân</h1>
    <p>{user.name}</p>
    <p className="text-sm text-muted-foreground">{user.email}</p>
    <PushSettings/>
    <SignOutButton/>
  </main>;
}
