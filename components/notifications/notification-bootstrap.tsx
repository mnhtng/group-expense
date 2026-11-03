"use client";
import { useEffect } from "react";
export function NotificationBootstrap(){
  useEffect(()=>{
    if("serviceWorker" in navigator && window.isSecureContext) {
      navigator.serviceWorker.register("/sw.js").catch(()=>{});
    }
  },[]);
  return null;
}
