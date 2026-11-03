"use client";

import { useState } from "react";

export function GroupInviteForm({
  groupId, initialInviteUrl,
}: {
  groupId: string;
  initialInviteUrl?: string;
}) {
  const [inviteUrl, setInviteUrl] = useState(initialInviteUrl ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  async function create() {
    if (pending) return;
    setPending(true);
    setError("");
    setCopied(false);
    try {
      const response = await fetch(`/api/groups/${groupId}/invites`, {
        method: "POST", credentials: "same-origin", cache: "no-store",
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result?.error ?? "Không tạo được link mời.");
      }
      setInviteUrl(new URL(`/invite/${result.token}`, window.location.origin).href);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không tạo được link mời.");
    } finally {
      setPending(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
    } catch {
      setError("Không sao chép được. Hãy nhấn giữ link.");
    }
  }

  return <div className="space-y-3">
    <button type="button" onClick={() => void create()} disabled={pending}
      className="min-h-12 rounded-2xl bg-secondary px-5 py-3 text-sm font-semibold disabled:opacity-50">
      {pending ? "Đang tạo liên kết..." : "Tạo link mời"}
    </button>
    {inviteUrl && <div className="space-y-3 rounded-2xl border p-4 text-sm">
      <p className="font-medium">Link mời</p>
      <a className="block break-all underline underline-offset-4" href={inviteUrl}>
        {inviteUrl}
      </a>
      <button type="button" onClick={() => void copy()}
        className="min-h-11 rounded-xl border px-4 py-2 text-sm font-medium">
        {copied ? "Đã sao chép" : "Sao chép link"}
      </button>
    </div>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </div>;
}
