"use client";
import { useRouter } from "next/navigation";
import { useState,type FormEvent } from "react";
import { OptionalNoteField } from "@/components/ui/optional-note-field";

export function CreateGroupForm(){
  const router=useRouter();
  const [name,setName]=useState("");
  const [note,setNote]=useState("");
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  async function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    if(busy)return;
    setBusy(true);setError("");
    try{
      const response=await fetch("/api/groups",{
        method:"POST",credentials:"same-origin",cache:"no-store",
        headers:{"Content-Type":"application/json"},body:JSON.stringify({name,note}),
      });
      const result=await response.json();
      if(!response.ok)throw Error(result.error??"Không thể tạo nhóm.");
      router.push(`/groups/${result.id}`);
      router.refresh(); // Navigate only after the server creates the group.
    }catch(e){setError(e instanceof Error?e.message:"Không thể tạo nhóm.");}
    finally{setBusy(false);}
  }
  return <form onSubmit={submit} className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
    <label className="sr-only" htmlFor="new-group-name">Tên nhóm mới</label>
    <input id="new-group-name" name="name" minLength={2} maxLength={120}
      value={name} onChange={e=>{setName(e.target.value);setError("");}}
      autoComplete="off" required placeholder="Nhập tên nhóm..."
      className="h-14 w-full min-w-0 rounded-2xl border bg-card px-4 text-base
        shadow-sm outline-none placeholder:text-muted-foreground/70
        focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/15"/>
    <div className="sm:col-span-2"><OptionalNoteField value={note} onChange={setNote}/></div>
    <button type="submit" disabled={busy}
      className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl
        bg-primary px-6 text-base font-semibold text-primary-foreground
        transition-opacity active:opacity-85 disabled:opacity-50 sm:w-auto">
      <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor"
        strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
      {busy?"Đang tạo...":"Tạo nhóm"}
    </button>
    {error&&<p role="alert" className="text-sm text-destructive sm:col-span-2">{error}</p>}
  </form>;
}
