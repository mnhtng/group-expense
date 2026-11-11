import {requireUser} from "@/lib/auth/session";
import {SignOutButton} from "@/components/auth/sign-out-button";
import {PushSettings} from "@/components/notifications/push-settings";
import {PageHeader} from "@/components/ui/app-screen";
export default async function SettingsPage(){
  const user=await requireUser();
  return <main className="app-page space-y-6">
    <PageHeader title="Cá nhân"/>
    <section className="app-panel flex items-center gap-4">
      <span className="flex size-14 shrink-0 items-center justify-center rounded-full bg-secondary text-2xl font-semibold" aria-hidden="true">{user.name.charAt(0)}</span>
      <div className="min-w-0"><h2 className="text-xl font-semibold">{user.name}</h2><p className="app-caption break-all">{user.email}</p></div>
    </section>
    <PushSettings/>
    <SignOutButton/>
  </main>;
}
