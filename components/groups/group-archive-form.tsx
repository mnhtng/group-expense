"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

export function GroupArchiveForm({groupId,groupName}:{
  groupId:string;groupName:string;
}){
  const router=useRouter();
  const [confirmation,setConfirmation]=useState("");
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  async function archive(e:FormEvent<HTMLFormElement>){
    e.preventDefault();
    if(busy||confirmation.trim()!==groupName)return;
    setBusy(true);setError("");
    try{
      const res=await fetch(`/api/groups/${groupId}/archive`,{
        method:"POST",credentials:"same-origin",cache:"no-store",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({confirmation}),
      });
      const result=await res.json();
      if(!res.ok)throw Error(result.error??"Không thể lưu trữ nhóm.");
      router.replace("/groups"); // Intentional only after successful archival.
      router.refresh();
    }catch(error){
      setError(error instanceof Error?error.message:"Có lỗi khi lưu trữ nhóm.");
    }finally{setBusy(false)}
  }
  return <form onSubmit={archive} className="space-y-3">
    <label htmlFor="archive-confirmation" className="block text-sm font-medium">
      Nhập đúng tên nhóm để xác nhận
    </label>
    <input id="archive-confirmation" name="confirmation" required placeholder="Tên nhóm"
      value={confirmation} onChange={e=>{setConfirmation(e.target.value);setError("");}}
      className="w-full rounded-2xl border bg-background px-4 py-3"/>
    <button type="submit" disabled={busy||confirmation.trim()!==groupName}
      className="min-h-12 rounded-2xl border border-destructive px-5 py-3 text-sm font-medium text-destructive disabled:opacity-50">
      {busy?"Đang lưu trữ...":"Lưu trữ nhóm"}
    </button>
    {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
  </form>;
}
