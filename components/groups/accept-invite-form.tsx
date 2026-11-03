"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { OptionalNoteField } from "@/components/ui/optional-note-field";

export function AcceptInviteForm({token}:{token:string}){
  const router=useRouter();
  const [busy,setBusy]=useState(false);
  const [note,setNote]=useState("");
  const [error,setError]=useState("");
  async function accept(){
    if(busy)return;
    setBusy(true);setError("");
    try{
      const res=await fetch("/api/invites/accept",{
        method:"POST",credentials:"same-origin",cache:"no-store",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({token,note}),
      });
      const body=await res.json();
      if(!res.ok)throw Error(body.error??"Không thể tham gia nhóm.");
      router.replace(`/groups/${body.groupId}`);
      router.refresh(); // Intentional navigation only after invite acceptance.
    }catch(e){setError(e instanceof Error?e.message:"Lời mời không hợp lệ.");}
    finally{setBusy(false);}
  }
  return <div className="space-y-3">
    <OptionalNoteField value={note} onChange={setNote} placeholder="Lời nhắn khi tham gia nhóm..."/>
    <button type="button" disabled={busy} onClick={()=>void accept()}
      className="min-h-12 rounded-xl bg-primary px-5 py-3 text-primary-foreground disabled:opacity-50">
      {busy?"Đang tham gia...":"Tham gia nhóm"}
    </button>
    {error&&<p role="alert" className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
  </div>;
}
