"use client";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";

export function SignOutButton() {
  const router = useRouter();
  return <button className="rounded-xl bg-secondary px-4 py-3" onClick={async () => {
    await authClient.signOut();
    router.replace("/sign-in");
    router.refresh();
  }}>Đăng xuất</button>;
}
