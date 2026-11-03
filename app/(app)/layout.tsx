import { Suspense } from "react";
import { requireUser } from "@/lib/auth/session";
import { NotificationBootstrap } from "@/components/notifications/notification-bootstrap";
import { NotificationNav } from "@/components/notifications/notification-nav";

async function AuthenticatedContent({ children }: { children: React.ReactNode }) {
  await requireUser();
  return <div className="app-shell min-h-dvh">
    <NotificationBootstrap/>
    {children}
    <NotificationNav/>
  </div>;
}
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={
    <main className="app-page" role="status">Đang xác thực phiên đăng nhập...</main>
  }>
    <AuthenticatedContent>{children}</AuthenticatedContent>
  </Suspense>;
}
