import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getCurrentSession } from "@/lib/auth/session";

async function RouteBySession() {
  const session = await getCurrentSession();
  redirect(session?.user ? "/groups" : "/sign-in");
  return null;
}

export default function Home() {
  return <Suspense fallback={<main className="mx-auto max-w-lg p-6" role="status">Đang mở ứng dụng...</main>}>
    <RouteBySession />
  </Suspense>;
}
