"use client";

import { useId, useState } from "react";
import { formatDateDMY, parseDateDMY } from "@/lib/date-format";

/**
 * Date-only input with an explicit, locale-independent d/m/yyyy display.
 * The native date picker is optional; ISO is the only value sent to the API.
 */
export function DateDMYInput({ value, onChange, label = "Ngày chi tiêu" }: {
  value: string;
  onChange: (isoDate: string) => void;
  label?: string;
}) {
  const id = useId();
  const [text, setText] = useState(() => value ? formatDateDMY(value) : "");
  const [touched, setTouched] = useState(false);
  const invalid = touched && (text.trim() === "" || !parseDateDMY(text));

  function edit(raw: string) {
    setText(raw);
    setTouched(true);
    onChange(parseDateDMY(raw) ?? "");
  }

  return <div className="space-y-1.5">
    <label htmlFor={id} className="block text-sm font-medium">{label}</label>
    <div className="flex min-w-0 gap-2">
      <input id={id} type="text" required inputMode="numeric" autoComplete="off"
        placeholder="d/m/yyyy" value={text} aria-invalid={invalid}
        aria-describedby={invalid ? `${id}-error` : undefined}
        onChange={event => edit(event.target.value)}
        onBlur={() => {
          setTouched(true);
          const parsed = parseDateDMY(text);
          if (parsed) setText(formatDateDMY(parsed));
        }}
        className="min-h-12 min-w-0 flex-1 rounded-xl border bg-background px-3 py-2 text-base tabular-nums" />
      <div className="relative flex min-h-12 w-16 shrink-0 items-center justify-center rounded-xl border bg-secondary text-sm font-medium">
        <span aria-hidden="true">Lịch</span>
        <input type="date" aria-label="Chọn ngày bằng lịch" title="Chọn ngày"
          value={value} tabIndex={0}
          onChange={event => {
            const iso = event.target.value;
            onChange(iso);
            setText(iso ? formatDateDMY(iso) : "");
            setTouched(true);
          }}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        />
      </div>
    </div>
    {invalid && <p id={`${id}-error`} role="alert" className="text-xs text-destructive">
      Nhập ngày hợp lệ theo d/m/yyyy, ví dụ 4/11/2026.
    </p>}
  </div>;
}
