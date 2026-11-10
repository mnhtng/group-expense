"use client";
import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { authClient } from "@/lib/auth-client";
import { safeReturnTo } from "@/lib/security/route-policy";
import { Suspense } from "react";

function SignInForm() {
  const router = useRouter();
  const search = useSearchParams();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  async function submit(form: FormData) {
    setError(""); setLoading(true);
    const result = await authClient.signIn.email({
      email: String(form.get("email") ?? ""),
      password: String(form.get("password") ?? ""),
      rememberMe: true,
    });
    setLoading(false);
    if (result.error) { setError("Email hoặc mật khẩu không chính xác."); return; }
    const requested = search.get("returnTo") ?? "/groups";
    router.replace(safeReturnTo(requested));
    router.refresh();
  }
  return <main className="app-page auth-page space-y-6">
    <h1 className="app-title">Đăng nhập</h1>
    <form action={submit} className="space-y-3">
      <label className="block space-y-2 font-medium"><span>Email</span>
      <input aria-label="Email" autoComplete="email" type="email" name="email" required placeholder="ban@example.com"
        className="w-full rounded-xl border bg-card p-3"/></label>
      <label className="block space-y-2 font-medium"><span>Mật khẩu</span>
      <input aria-label="Mật khẩu" autoComplete="current-password" type="password" name="password" required placeholder="Mật khẩu"
        className="w-full rounded-xl border bg-card p-3"/></label>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <button disabled={loading} className="app-action w-full">
        {loading ? "Đang đăng nhập..." : "Đăng nhập"}
      </button>
    </form>
    <Link href="/sign-up" className="underline">Tạo tài khoản</Link>
  </main>;
}
export default function SignInPage() { return <Suspense><SignInForm /></Suspense>; }
