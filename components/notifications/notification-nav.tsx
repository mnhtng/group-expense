"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

type TabIcon = "groups" | "debts" | "notifications" | "profile";
const links: { href: string; label: string; icon: TabIcon }[] = [
  {href:"/groups",label:"Nhóm",icon:"groups"},
  {href:"/debts",label:"Công nợ",icon:"debts"},
  {href:"/activity",label:"Thông báo",icon:"notifications"},
  {href:"/settings",label:"Cá nhân",icon:"profile"},
];

function TabIconSvg({ name, active }: { name: TabIcon; active: boolean }) {
  const shared = {fill:"none",stroke:"currentColor",strokeWidth:1.8,
    strokeLinecap:"round" as const,strokeLinejoin:"round" as const};
  const icon = {
    groups: <><path d="M3 10.5 12 3l9 7.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 19.5z"/>
      <path d="M9 21v-7h6v7"/></>,
    debts: <><rect x="3" y="5" width="18" height="15" rx="3"/>
      <path d="M3 9h18M16 15h2"/></>,
    notifications: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9z"/>
      <path d="M10 21h4"/></>,
    profile: <><circle cx="12" cy="8" r="4"/>
      <path d="M4.5 21a7.5 7.5 0 0 1 15 0"/></>,
  };
  return <svg viewBox="0 0 24 24" className={`size-6 ${active?"stroke-[2.1]":""}`}
    aria-hidden="true" {...shared}>{icon[name]}</svg>;
}

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

  return <nav aria-label="Điều hướng chính" className="app-bottom-nav fixed inset-x-0 bottom-0 z-40
    border-t border-border/70 bg-background/95 shadow-[0_-8px_30px_rgba(0,0,0,0.035)]
    backdrop-blur-xl supports-[backdrop-filter]:bg-background/85"
    style={{paddingBottom:"var(--app-tabbar-safe-bottom)"}}>
    <div className="app-tabbar-inner mx-auto grid max-w-2xl grid-cols-4 gap-2 pt-2">
      {links.map(link=>{
        const active=path===link.href || (link.href==="/groups" && path.startsWith("/groups/"));
        return <Link key={link.href} href={link.href}
          aria-current={active?"page":undefined}
          className={`relative flex min-h-[68px] min-w-0 flex-col items-center justify-center gap-1 rounded-2xl
            px-1 py-2 text-[11px] font-medium leading-tight transition-colors active:scale-[0.98]
            ${active?"bg-secondary text-foreground":"text-muted-foreground hover:bg-secondary/60 hover:text-foreground"}`}>
          <span className="relative flex items-center justify-center">
            <TabIconSvg name={link.icon} active={active}/>
            {link.href==="/activity"&&unread>0&&
              <span aria-label={`${unread} thông báo chưa đọc`}
                className="absolute -right-3 -top-2 flex min-h-4 min-w-4 items-center justify-center
                  rounded-full bg-primary px-1 text-[9px] font-semibold leading-none text-primary-foreground">
                {unread>99?"99+":unread}
              </span>}
          </span>
          <span className="truncate max-w-full">{link.label}</span>
        </Link>;
      })}
    </div>
  </nav>;
}
