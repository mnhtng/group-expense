"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function DeleteExpenseButton({ groupId, expenseId, version }: {
  groupId: string; expenseId: string; version: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function remove() {
    if (!window.confirm("Xóa hóa đơn này? Hành động sẽ được ghi lịch sử và không thể hoàn tác.")) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/groups/${groupId}/expenses/${expenseId}`, {
        method: "DELETE", headers: { "Content-Type": "application/json" },
        credentials: "same-origin", cache: "no-store",
        body: JSON.stringify({ expectedVersion: version }),
      });
      if (!response.ok) {
        const data = await response.json();
        setError(data?.error ?? "Không thể xóa hóa đơn.");
      } else {
        router.replace(`/groups/${groupId}`);
        router.refresh();
      }
    } catch { setError("Không thể kết nối. Vui lòng thử lại."); }
    finally { setBusy(false); }
  }
  return <div className="space-y-2">
    <button type="button" disabled={busy} onClick={remove}
      className="rounded-xl border border-destructive px-4 py-3 text-sm text-destructive disabled:opacity-50">
      {busy ? "Đang xóa..." : "Xóa hóa đơn"}
    </button>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </div>;
}
