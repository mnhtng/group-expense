"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
const links=[{href:"/groups",label:"Nhóm"},{href:"/debts",label:"Công nợ"},
  {href:"/activity",label:"Thông báo"},{href:"/settings",label:"Cá nhân"}];
export function NotificationNav(){
  const [unread,setUnread]=useState(0);
  const path=usePathname();
  useEffect(()=>{
    let cancelled=false;
    const update=async()=>{
      try {
        const r=await fetch("/api/notifications?limit=1",{credentials:"same-origin",cache:"no-store"});
        if(r.ok&&!cancelled){const data=await r.json();setUnread(data.unreadCount??0);}
      }catch{}
    };
    void update();
    const timer=window.setInterval(()=>{if(document.visibilityState==="visible")void update();},25_000);
    const focus=()=>void update();
    window.addEventListener("focus",focus);
    return ()=>{cancelled=true;window.clearInterval(timer);window.removeEventListener("focus",focus);};
  },[path]);
  return <nav aria-label="Điều hướng ứng dụng"
    className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 px-2 pb-[max(env(safe-area-inset-bottom),8px)] pt-2 backdrop-blur">
    <div className="mx-auto flex max-w-lg justify-around gap-1">
      {links.map(link=><Link key={link.href} href={link.href}
        aria-current={path===link.href?"page":undefined}
        className={`min-w-0 flex-1 rounded-xl px-2 py-2 text-center text-xs ${path===link.href?"bg-secondary font-semibold":"text-muted-foreground"}`}>
        {link.label}
        {link.href==="/activity"&&unread>0&&<span className="ml-1 rounded-full bg-primary px-1.5 py-0.5 text-[10px] text-primary-foreground">
          {unread>99?"99+":unread}
        </span>}
      </Link>)}
    </div>
  </nav>;
}
