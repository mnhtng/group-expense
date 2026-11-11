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
  return <main className="app-page auth-page space-y-6">
    <h1 className="app-title">Tạo tài khoản</h1>
    <form action={submit} className="space-y-3">
      <label className="block space-y-2 font-medium"><span>Tên của bạn</span>
      <input name="name" minLength={2} required placeholder="Tên hiển thị" autoComplete="name"
        className="w-full rounded-xl border bg-card p-3" /></label>
      <label className="block space-y-2 font-medium"><span>Email</span>
      <input name="email" type="email" required placeholder="Email" autoComplete="email"
        className="w-full rounded-xl border bg-card p-3" /></label>
      <label className="block space-y-2 font-medium"><span>Mật khẩu · Từ 10 ký tự</span>
      <input name="password" type="password" minLength={10} required placeholder="Mật khẩu (từ 10 ký tự)" autoComplete="new-password"
        className="w-full rounded-xl border bg-card p-3" /></label>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <button disabled={loading} className="app-action w-full">
        {loading ? "Đang tạo..." : "Đăng ký"}
      </button>
    </form>
    <Link href="/sign-in" className="underline">Đã có tài khoản?</Link>
  </main>;
}
