"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { mergeNotificationFeed } from "@/lib/notifications/merge-feed";
import { useRouter } from "next/navigation";
type Notification={
  id:string;kind:string;title:string;body:string;href:string;
  readAt:string|null;createdAt:string;actorName:string;groupName:string;
};
export function NotificationInbox(){
  const router=useRouter();
  const [rows,setRows]=useState<Notification[]>([]);
  const [nextCursor,setNextCursor]=useState<string|null>(null);
  const [unread,setUnread]=useState(0);
  const [busy,setBusy]=useState(true);
  const [error,setError]=useState("");
  const [mutating,setMutating]=useState(false);
  const [loadingMore,setLoadingMore]=useState(false);
  const loadedOlder=useRef(false);
  const load=useCallback(async(cursor?:string)=>{
    if(cursor){loadedOlder.current=true;setLoadingMore(true);}
    try{
      const response=await fetch(`/api/notifications?limit=20${cursor?`&cursor=${cursor}`:""}`,
        {cache:"no-store",credentials:"same-origin"});
      if(!response.ok)throw Error("Không thể tải thông báo.");
      const data=await response.json();
      setRows(previous=>mergeNotificationFeed(previous,data.notifications,Boolean(cursor)));
      // Background refresh must not reset a cursor after the user loaded
      // older pages. The list stays mounted and the scroll remains stable.
      if(cursor || !loadedOlder.current)setNextCursor(data.nextCursor??null);
      setUnread(data.unreadCount??0);
      setError("");
    }catch(e){setError(e instanceof Error?e.message:"Không thể tải thông báo.");}
    finally{setBusy(false);if(cursor)setLoadingMore(false)}
  },[]);
  useEffect(()=>{
    queueMicrotask(()=>{void load();});
    const interval=window.setInterval(()=>{if(document.visibilityState==="visible")void load();},30_000);
    const onFocus=()=>{void load();};
    window.addEventListener("focus",onFocus);
    return ()=>{window.clearInterval(interval);window.removeEventListener("focus",onFocus)};
  },[load]);
  async function open(row:Notification){
    if(!row.readAt) {
      try{
        const res=await fetch(`/api/notifications/${row.id}`,{method:"PATCH",credentials:"same-origin"});
        if(!res.ok)throw Error("Mark as read failed");
        setRows(old=>old.map(x=>x.id===row.id?{...x,readAt:new Date().toISOString()}:x));
        setUnread(n=>Math.max(0,n-1));
      }catch{ /* navigation remains available even if the mark-as-read call fails */ }
    }
    router.push(row.href);
  }
  async function markAll(){
    setMutating(true);
    try{
      const res=await fetch("/api/notifications/read-all",{method:"POST",credentials:"same-origin"});
      if(!res.ok)throw Error("Không thể cập nhật thông báo.");
      setRows(old=>old.map(x=>({...x,readAt:x.readAt??new Date().toISOString()})));
      setUnread(0);
    }catch(e){setError(e instanceof Error?e.message:"Không thể đánh dấu đã đọc.");}
    finally{setMutating(false);}
  }
  return <section className="space-y-4">
    <div className="flex items-center justify-between gap-3">
      <p className="text-sm text-muted-foreground">{unread} chưa đọc</p>
      <button type="button" disabled={mutating||unread===0} onClick={markAll}
        className="rounded-xl border px-3 py-2 text-sm disabled:opacity-50">Đọc tất cả</button>
    </div>
    {error&&<p role="alert" className="rounded-xl border p-3 text-sm text-destructive">{error}</p>}
    {busy&&<p role="status" className="text-sm text-muted-foreground">Đang tải thông báo...</p>}
    {!busy&&rows.length===0&&<p className="rounded-2xl border border-dashed p-5 text-sm text-muted-foreground">
      Chưa có thông báo.
    </p>}
    <div className="space-y-3">
      {rows.map(row=><button type="button" key={row.id} onClick={()=>void open(row)}
        className={`block w-full rounded-2xl border p-4 text-left ${row.readAt?"bg-card":"bg-secondary"}`}>
        <div className="flex items-start gap-3">
          {!row.readAt&&<span aria-label="Chưa đọc" className="mt-2 h-2 w-2 shrink-0 rounded-full bg-primary"/>}
          <div className="min-w-0 flex-1">
            <strong className="block text-sm">{row.title}</strong>
            <p className="mt-1 text-sm">{row.body}</p>
            <p className="mt-2 text-xs text-muted-foreground">
              {row.actorName} · {row.groupName} · {new Date(row.createdAt).toLocaleString("vi-VN")}
            </p>
          </div>
        </div>
      </button>)}
    </div>
    {nextCursor&&<button type="button" disabled={loadingMore}
      onClick={()=>{if(!loadingMore)void load(nextCursor);}}
      className="min-h-11 w-full rounded-xl border px-4 py-3 text-sm disabled:opacity-50">
      {loadingMore?"Đang tải...":"Tải thêm"}
    </button>}
  </section>;
}
