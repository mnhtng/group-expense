import { Suspense } from "react";
import { requireUser } from "@/lib/auth/session";

async function AuthenticatedContent({ children }: { children: React.ReactNode }) {
  await requireUser();
  return children;
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<main className="mx-auto max-w-lg p-6" role="status">Đang xác thực phiên đăng nhập...</main>}>
      <AuthenticatedContent>{children}</AuthenticatedContent>
    </Suspense>
  );
}
