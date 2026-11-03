"use client";

import { useId } from "react";

export function OptionalNoteField({
  value, onChange, maxLength = 1000, placeholder = "Thêm thông tin cần nhớ...",
}: {
  value: string;
  onChange: (note: string) => void;
  maxLength?: number;
  placeholder?: string;
}) {
  const id = useId();
  return <div className="space-y-1.5">
    <label htmlFor={id} className="block text-sm font-medium">Ghi chú <span className="font-normal text-muted-foreground">(không bắt buộc)</span></label>
    <textarea id={id} name="note" rows={2} maxLength={maxLength}
      placeholder={placeholder} value={value}
      onChange={event => onChange(event.target.value)}
      className="w-full resize-y rounded-xl border bg-background p-3 text-base placeholder:text-muted-foreground/70" />
  </div>;
}
