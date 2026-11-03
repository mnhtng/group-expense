"use client";

/**
 * Non-modal, persistent confirmation region. Unlike window.confirm or a
 * native disclosure, clicks on its controls cannot dismiss it accidentally.
 */
import { OptionalNoteField } from "@/components/ui/optional-note-field";

export function InlineConfirmation({
  title,description,confirmLabel,onConfirm,onCancel,busy=false,danger=false,
  note,onNoteChange,
}:{
  title:string;description:string;confirmLabel:string;
  onConfirm:()=>void;onCancel:()=>void;busy?:boolean;danger?:boolean;
  note?:string;onNoteChange?:(value:string)=>void;
}){
  return <div role="group" aria-label={title}
    className="space-y-3 rounded-2xl border border-border bg-secondary/50 p-4"
    data-testid="inline-confirmation">
    <p className="text-sm font-semibold">{title}</p>
    <p className="text-sm leading-relaxed text-muted-foreground">{description}</p>
    {onNoteChange&&<OptionalNoteField value={note??""} onChange={onNoteChange} maxLength={1000}/>}
    <div className="flex flex-wrap gap-3">
      <button type="button" onClick={onCancel} disabled={busy}
        className="min-h-11 rounded-xl border bg-background px-4 py-2 text-sm font-medium disabled:opacity-50">
        Hủy
      </button>
      <button type="button" onClick={onConfirm} disabled={busy}
        className={`min-h-11 rounded-xl px-4 py-2 text-sm font-semibold disabled:opacity-50
          ${danger?"bg-destructive text-white":"bg-primary text-primary-foreground"}`}>
        {busy?"Đang xử lý...":confirmLabel}
      </button>
    </div>
  </div>;
}
