"use client";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
export function SignOutButton(){
  const router=useRouter();
  async function signOut(){
    try{
      if("serviceWorker" in navigator){
        const reg=await navigator.serviceWorker.getRegistration("/");
        const sub=await reg?.pushManager.getSubscription();
        if(sub){
          const response=await fetch("/api/push/subscriptions",{
            method:"DELETE",headers:{"content-type":"application/json"},
            body:JSON.stringify({endpoint:sub.endpoint}),
          });
          if(!response.ok)throw Error("Không thể ngắt Web Push trên thiết bị.");
          await sub.unsubscribe();
        }
      }
    }catch{
      // The user must still be able to terminate their server session.
      // The server removes subscriptions of signed-out users from future deliveries
      // when their browser explicitly unsubscribes.
    }
    await authClient.signOut();
    router.replace("/sign-in");
    router.refresh();
  }
  return <button className="rounded-xl bg-secondary px-4 py-3" onClick={()=>void signOut()}>
    Đăng xuất
  </button>;
}
