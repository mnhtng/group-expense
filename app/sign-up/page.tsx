"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { authClient } from "@/lib/auth-client";

export default function SignUpPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  async function submit(form: FormData) {
    setLoading(true); setError("");
    const response = await authClient.signUp.email({
      name: String(form.get("name") ?? ""),
      email: String(form.get("email") ?? ""),
      password: String(form.get("password") ?? ""),
    });
    setLoading(false);
    if (response.error) { setError(response.error.message ?? "Không thể đăng ký."); return; }
    router.replace("/groups"); router.refresh();
  }
  return <main className="mx-auto max-w-md space-y-6 px-5 py-12">
    <h1 className="font-heading text-2xl font-semibold">Tạo tài khoản</h1>
    <form action={submit} className="space-y-3">
      <input name="name" minLength={2} required placeholder="Tên hiển thị" autoComplete="name"
        className="w-full rounded-xl border bg-background p-3" />
      <input name="email" type="email" required placeholder="Email" autoComplete="email"
        className="w-full rounded-xl border bg-background p-3" />
      <input name="password" type="password" minLength={10} required placeholder="Mật khẩu (từ 10 ký tự)" autoComplete="new-password"
        className="w-full rounded-xl border bg-background p-3" />
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <button disabled={loading} className="w-full rounded-xl bg-primary p-3 text-primary-foreground">
        {loading ? "Đang tạo..." : "Đăng ký"}
      </button>
    </form>
    <Link href="/sign-in" className="underline">Đã có tài khoản?</Link>
  </main>;
}
