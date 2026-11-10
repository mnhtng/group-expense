"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import {AppIcon} from "@/components/ui/app-screen";

type TabIcon = "groups" | "wallet" | "bell" | "person";
const links: { href: string; label: string; icon: TabIcon }[] = [
  {href:"/groups",label:"Nhóm",icon:"groups"},
  {href:"/debts",label:"Công nợ",icon:"wallet"},
  {href:"/activity",label:"Thông báo",icon:"bell"},
  {href:"/settings",label:"Cá nhân",icon:"person"},
];

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
          className={`relative flex min-h-16 min-w-0 flex-col items-center justify-center gap-1 rounded-2xl
            px-1 py-2 text-[14px] font-medium leading-tight transition-colors
            ${active?"bg-secondary text-foreground":"text-muted-foreground hover:bg-secondary/60 hover:text-foreground"}`}>
          <span className="relative flex items-center justify-center">
            <AppIcon name={link.icon}/>
            {link.href==="/activity"&&unread>0&&
              <span aria-label={`${unread} thông báo chưa đọc`}
                className="absolute -right-3 -top-2 flex min-h-5 min-w-5 items-center justify-center
                  rounded-full bg-primary px-1 text-[12px] font-semibold leading-none text-primary-foreground">
                {unread>99?"99+":unread}
              </span>}
          </span>
          <span className="truncate max-w-full">{link.label}</span>
        </Link>;
      })}
    </div>
  </nav>;
}
