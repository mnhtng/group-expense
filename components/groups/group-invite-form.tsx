"use client";

import { useEffect, useState } from "react";
import { InviteQr } from "@/components/groups/invite-qr";
import { normalizeInviteUrl } from "@/lib/invites/invite-link";
import { OptionalNoteField } from "@/components/ui/optional-note-field";

export function GroupInviteForm({
  groupId, groupName, initialInviteUrl,
}: {
  groupId: string;
  groupName: string;
  initialInviteUrl?: string;
}) {
  const [inviteUrl, setInviteUrl] = useState(initialInviteUrl ?? "");
  const [pending, setPending] = useState(false);
  const [note, setNote] = useState("");
  useEffect(()=>{
    if(!initialInviteUrl)return;
    const normalized=normalizeInviteUrl(initialInviteUrl,window.location.origin);
    if(normalized)queueMicrotask(()=>setInviteUrl(normalized));
  },[initialInviteUrl]);
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
        headers:{"Content-Type":"application/json"},body:JSON.stringify({note}),
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result?.error ?? "Không tạo được link mời.");
      }
      const normalized=normalizeInviteUrl(`/invite/${result.token}`,window.location.origin);
      if(!normalized)throw new Error("Link mời không hợp lệ.");
      setInviteUrl(normalized);
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
    <OptionalNoteField value={note} onChange={setNote} placeholder="Lời nhắn dành cho người được mời..."/>
    <button type="button" onClick={() => void create()} disabled={pending}
      className="min-h-12 rounded-2xl bg-secondary px-5 py-3 text-sm font-semibold disabled:opacity-50">
      {pending ? "Đang tạo liên kết..." : "Tạo link mời"}
    </button>
    {inviteUrl && <div className="space-y-3 rounded-2xl border p-4 text-sm">
      <InviteQr key={inviteUrl} url={inviteUrl} groupName={groupName}/>
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
