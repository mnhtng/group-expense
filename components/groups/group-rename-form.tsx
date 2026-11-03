"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { OptionalNoteField } from "@/components/ui/optional-note-field";

export function GroupRenameForm({groupId,initialName,initialNotes}:{
  groupId:string;initialName:string;initialNotes?:string;
}){
  const router=useRouter();
  const [name,setName]=useState(initialName);
  const [savedName,setSavedName]=useState(initialName);
  const [note,setNote]=useState(initialNotes??"");
  const [savedNote,setSavedNote]=useState(initialNotes??"");
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [success,setSuccess]=useState("");
  async function save(e:FormEvent<HTMLFormElement>){
    e.preventDefault();
    if(busy||(name.trim()===savedName&&note.trim()===savedNote))return;
    setBusy(true);setError("");setSuccess("");
    try {
      const res=await fetch(`/api/groups/${groupId}/rename`,{
        method:"PATCH",credentials:"same-origin",cache:"no-store",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({name,note}),
      });
      const data=await res.json();
      if(!res.ok)throw Error(data.error??"Không thể đổi tên nhóm.");
      setName(data.name);setSavedName(data.name);
      setNote(data.notes??"");setSavedNote(data.notes??"");
      setSuccess("Đã đổi tên nhóm.");
      // Updating server-rendered headings does not navigate away or collapse UI.
      router.refresh();
    }catch(error){setError(error instanceof Error?error.message:"Không thể lưu thay đổi.");}
    finally{setBusy(false);}
  }
  return <form onSubmit={save} className="grid gap-3">
    <label htmlFor="group-name" className="text-sm font-medium">Tên nhóm</label>
    <input id="group-name" aria-label="Đổi tên nhóm" name="name" required
      minLength={2} maxLength={120} value={name} onChange={e=>{
        setName(e.target.value);setError("");setSuccess("");
      }} className="min-w-0 rounded-2xl border bg-background px-4 py-3"/>
    <OptionalNoteField value={note} onChange={value=>{setNote(value);setSuccess("");}}/>
    <button type="submit" disabled={busy||(name.trim()===savedName&&note.trim()===savedNote)}
      className="min-h-12 rounded-2xl bg-secondary px-5 py-3 text-sm font-semibold disabled:opacity-50">
      {busy?"Đang lưu...":"Lưu tên nhóm"}
    </button>
    {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
    {success&&<p role="status" className="text-sm text-muted-foreground">{success}</p>}
  </form>;
}
