"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { InlineConfirmation } from "@/components/ui/inline-confirmation";

type Member = { id: string; name: string; role: string };
export type StoredExpense = {
  id: string; title: string; notes: string; occurredOn: string; payerId: string;
  version: number;
  items: { id: string; name: string; quantity: number; unitPriceMinor: string;
    shares: { userId: string; amountMinor: string }[] }[];
};
type Row = {
  key: string; name: string; quantity: string; unitPriceMinor: string;
  participants: string[]; mode: "equal" | "manual"; custom: Record<string, string>;
};
const formatVnd = (minor: bigint) => new Intl.NumberFormat("vi-VN").format(minor) + " ₫";
const today = () => {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
};
function nextRow(members: Member[]): Row {
  return { key: crypto.randomUUID(), name: "", quantity: "1", unitPriceMinor: "",
    participants: members.map(m => m.id), mode: "equal", custom: {} };
}
function fromStored(item: StoredExpense["items"][number]): Row {
  return { key: item.id, name: item.name, quantity: String(item.quantity),
    unitPriceMinor: item.unitPriceMinor,
    participants: item.shares.map(s => s.userId), mode: "manual",
    custom: Object.fromEntries(item.shares.map(s => [s.userId, s.amountMinor])) };
}
export function ExpenseForm({ groupId, members, expense }: {
  groupId: string; members: Member[]; expense?: StoredExpense;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(expense?.title ?? "");
  const [notes, setNotes] = useState(expense?.notes ?? "");
  const [occurredOn, setOccurredOn] = useState(expense?.occurredOn ?? today());
  const [payerId, setPayerId] = useState(expense?.payerId ?? members[0]?.id ?? "");
  const [rows, setRows] = useState<Row[]>(
    () => expense?.items.map(fromStored) ?? [nextRow(members)]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [removeRowKey,setRemoveRowKey] = useState<string|null>(null);
  function changeRow(key: string, update: Partial<Row>) {
    setRows(prev => prev.map(row => row.key === key ? { ...row, ...update } : row));
  }
  const total = useMemo(() => rows.reduce((sum, item) => {
    if (!/^\d+$/.test(item.quantity) || !/^\d+$/.test(item.unitPriceMinor)) return sum;
    return sum + BigInt(item.quantity) * BigInt(item.unitPriceMinor);
  }, 0n), [rows]);
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setSaving(true); setError("");
    const payload = {
      title, notes, occurredOn, payerId,
      items: rows.map(row => ({
        name: row.name, quantity: Number(row.quantity),
        unitPriceMinor: row.unitPriceMinor,
        participants: row.participants,
        ...(row.mode === "manual" ? {
          shares: row.participants.map(id => ({ userId: id, amountMinor: row.custom[id] ?? "" }))
        } : {}),
      })),
    };
    try {
      const path = `/api/groups/${groupId}/expenses${expense ? `/${expense.id}` : ""}`;
      const response = await fetch(path, {
        method: expense ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        cache: "no-store",
        body: JSON.stringify(expense
          ? { expectedVersion: expense.version, expense: payload }
          : payload),
      });
      const result = await response.json();
      if (!response.ok) {
        setError(result?.error ?? "Không thể lưu hóa đơn.");
        return;
      }
      router.push(`/groups/${groupId}/expenses/${result.id}`);
      router.refresh();
    } catch {
      setError("Lỗi kết nối. Kiểm tra mạng rồi thử lại.");
    } finally { setSaving(false); }
  }

  return <form onSubmit={onSubmit} className="space-y-5 pb-8">
    <div className="space-y-4 rounded-3xl border bg-card p-5">
      <label className="block text-sm font-medium">Tên hóa đơn
        <input required maxLength={160} value={title} onChange={e => setTitle(e.target.value)}
          placeholder="Ví dụ: Mua đồ ăn tối" className="mt-1 w-full rounded-xl border bg-background p-3"/>
      </label>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="text-sm font-medium">Ngày chi tiêu
          <input required type="date" value={occurredOn} onChange={e => setOccurredOn(e.target.value)}
            className="mt-1 w-full min-w-0 rounded-xl border bg-background p-3"/>
        </label>
        <label className="text-sm font-medium">Người trả tiền
          <select required value={payerId} onChange={e => setPayerId(e.target.value)}
            className="mt-1 w-full min-w-0 rounded-xl border bg-background p-3">
            {members.map(member => <option key={member.id} value={member.id}>{member.name}</option>)}
          </select>
        </label>
      </div>
      <label className="block text-sm font-medium">Ghi chú (tùy chọn)
        <textarea maxLength={1000} rows={2} value={notes} onChange={e => setNotes(e.target.value)}
          className="mt-1 w-full rounded-xl border bg-background p-3"/>
      </label>
    </div>
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Các món ({rows.length})</h2>
        <button type="button" disabled={rows.length >= 50} onClick={() => setRows(prev => [...prev, nextRow(members)])}
          className="rounded-xl bg-secondary px-3 py-2 text-sm font-semibold">+ Thêm món</button>
      </div>
      {rows.map((row, index) => {
        const amount = /^\d+$/.test(row.quantity) && /^\d+$/.test(row.unitPriceMinor)
          ? BigInt(row.quantity) * BigInt(row.unitPriceMinor) : 0n;
        return <section key={row.key} className="space-y-4 rounded-3xl border bg-card p-5">
          <div className="flex items-center justify-between">
            <strong className="text-sm">Món {index + 1}</strong>
            <button type="button" disabled={rows.length === 1}
              className="min-h-11 rounded-xl px-3 text-sm text-destructive disabled:opacity-50"
              onClick={() => setRemoveRowKey(row.key)}>Xóa món</button>
          </div>
          {removeRowKey===row.key&&<InlineConfirmation
            title={`Xóa món ${index+1}?`}
            description="Món và số tiền đã nhập sẽ bị xóa."
            confirmLabel="Xóa món" danger
            onCancel={()=>setRemoveRowKey(null)}
            onConfirm={()=>{
              setRows(prev=>prev.filter(x=>x.key!==row.key));
              setRemoveRowKey(null);
            }}/>}
          <input aria-label={`Tên món ${index + 1}`} required maxLength={160} value={row.name}
            onChange={e => changeRow(row.key, { name: e.target.value })}
            placeholder="Tên món hàng" className="w-full rounded-xl border bg-background p-3"/>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs text-muted-foreground">Số lượng
              <input type="number" min="1" max="9999" step="1" required inputMode="numeric"
                value={row.quantity} onChange={e => changeRow(row.key, { quantity: e.target.value })}
                className="mt-1 w-full rounded-xl border bg-background p-3 text-base text-foreground"/>
            </label>
            <label className="text-xs text-muted-foreground">Đơn giá (VND)
              <input type="text" required inputMode="numeric" pattern="[0-9]+" placeholder="65000"
                value={row.unitPriceMinor} onChange={e => changeRow(row.key, { unitPriceMinor: e.target.value.replace(/\s/g, "") })}
                className="mt-1 w-full rounded-xl border bg-background p-3 text-base text-foreground"/>
            </label>
          </div>
          <p className="text-right text-sm font-semibold">Thành tiền: {formatVnd(amount)}</p>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Chia cho</legend>
            <div className="flex flex-wrap gap-2">
              {members.map(member => {
                const active = row.participants.includes(member.id);
                return <label key={member.id} className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm ${active ? "bg-secondary" : "opacity-70"}`}>
                  <input type="checkbox" checked={active} onChange={e => changeRow(row.key, {
                    participants: e.target.checked
                      ? [...row.participants, member.id]
                      : row.participants.filter(id => id !== member.id),
                  })}/>
                  {member.name}
                </label>;
              })}
            </div>
          </fieldset>
          <div className="flex gap-3 text-sm">
            <label className="flex items-center gap-2">
              <input type="radio" name={`mode-${row.key}`} checked={row.mode === "equal"}
                onChange={() => changeRow(row.key, { mode: "equal" })}/> Chia đều
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" name={`mode-${row.key}`} checked={row.mode === "manual"}
                onChange={() => changeRow(row.key, { mode: "manual" })}/> Nhập số tiền
            </label>
          </div>
          {row.mode === "manual" && <div className="space-y-2 rounded-xl bg-muted p-3">
            {row.participants.map(id => <label key={id} className="flex items-center gap-3 text-sm">
              <span className="min-w-0 flex-1 truncate">{members.find(m => m.id === id)?.name ?? "Thành viên"}</span>
              <input inputMode="numeric" pattern="[0-9]+" required aria-label={`Tiền chia cho ${members.find(m=>m.id===id)?.name}`}
                value={row.custom[id] ?? ""} placeholder="0"
                onChange={e => changeRow(row.key, { custom: { ...row.custom, [id]: e.target.value.trim() } })}
                className="w-32 rounded-lg border bg-background p-2 text-right text-base"/>
            </label>)}
            <p className="text-xs text-muted-foreground">Tổng phần chia phải bằng thành tiền.</p>
          </div>}
        </section>;
      })}
    </div>
    {error && <p role="alert" className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
    <div className="expense-save-footer sticky -mx-5 flex flex-wrap items-center justify-between gap-4 border-t bg-background/95 px-5 py-3 backdrop-blur"
      style={{bottom:"calc(var(--app-tabbar-content-height, 76px) + var(--app-tabbar-safe-bottom, 12px))"}}>
      <div><p className="text-xs text-muted-foreground">Tổng hóa đơn</p>
        <p className="text-lg font-bold tabular-nums">{formatVnd(total)}</p></div>
      <button type="submit" disabled={saving || !members.length}
        className="rounded-xl bg-primary px-5 py-3 font-semibold text-primary-foreground disabled:opacity-50">
        {saving ? "Đang lưu..." : expense ? "Lưu thay đổi" : "Tạo hóa đơn"}
      </button>
    </div>
  </form>;
}
