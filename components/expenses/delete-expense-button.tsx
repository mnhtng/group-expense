"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { InlineConfirmation } from "@/components/ui/inline-confirmation";

export function DeleteExpenseButton({ groupId, expenseId, version }: {
  groupId: string; expenseId: string; version: number;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note,setNote]=useState("");
  async function remove() {
    if(busy) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/groups/${groupId}/expenses/${expenseId}`, {
        method: "DELETE", headers: { "Content-Type": "application/json" },
        credentials: "same-origin", cache: "no-store",
        body: JSON.stringify({ expectedVersion: version, note }),
      });
      if (!response.ok) {
        const data = await response.json();
        setError(data?.error ?? "Không thể xóa khoản chi.");
      } else {
        setConfirming(false);
        router.replace(`/groups/${groupId}`);
        router.refresh(); // Intended navigation only after confirmed deletion.
      }
    } catch { setError("Không thể kết nối. Vui lòng thử lại."); }
    finally { setBusy(false); }
  }
  return <div className="space-y-3">
    {!confirming&&<button type="button" disabled={busy} onClick={()=>{setError("");setConfirming(true);}}
      className="min-h-11 rounded-xl border border-destructive px-4 py-3 text-sm text-destructive disabled:opacity-50">
      Xóa khoản chi
    </button>}
    {confirming&&<InlineConfirmation title="Xóa khoản chi này?"
      description="Không thể hoàn tác. Khoản chi đã thanh toán không thể xóa."
      confirmLabel="Xóa khoản chi" danger busy={busy}
      note={note} onNoteChange={setNote}
      onCancel={()=>{setConfirming(false);setError("");setNote("");}} onConfirm={()=>void remove()}/>}
    {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
  </div>;
}
