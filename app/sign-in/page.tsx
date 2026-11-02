"use client";
import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { authClient } from "@/lib/auth-client";
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
    router.replace(requested.startsWith("/") && !requested.startsWith("//") && !requested.includes("\\") ? requested : "/groups");
    router.refresh();
  }
  return <main className="mx-auto max-w-md space-y-6 px-5 py-12">
    <h1 className="font-heading text-2xl font-semibold">Đăng nhập</h1>
    <form action={submit} className="space-y-3">
      <input aria-label="Email" autoComplete="email" type="email" name="email" required placeholder="Email"
        className="w-full rounded-xl border bg-background p-3"/>
      <input aria-label="Mật khẩu" autoComplete="current-password" type="password" name="password" required placeholder="Mật khẩu"
        className="w-full rounded-xl border bg-background p-3"/>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <button disabled={loading} className="w-full rounded-xl bg-primary p-3 text-primary-foreground">
        {loading ? "Đang đăng nhập..." : "Đăng nhập"}
      </button>
    </form>
    <Link href="/sign-up" className="underline">Tạo tài khoản</Link>
  </main>;
}
export default function SignInPage() { return <Suspense><SignInForm /></Suspense>; }
