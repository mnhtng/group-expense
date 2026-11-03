/* Financial data is network-only; cache a public offline fallback only. */
self.addEventListener("push", event => {
  if (!event.data) return;
  event.waitUntil((async () => {
    let payload;
    try { payload = event.data.json(); } catch { return; }
    if (!payload || typeof payload.title !== "string") return;
    const destination = new URL(typeof payload.url === "string" ? payload.url : "/", self.location.origin);
    const url = destination.origin === self.location.origin ? destination.href : self.location.origin + "/";
    await self.registration.showNotification(payload.title.slice(0,160), {
      body: typeof payload.body === "string" ? payload.body.slice(0,500) : "",
      icon: "/icon.svg",
      badge: "/icon.svg",
      tag: "group-expense-" + url,
      data: { url },
    });
  })());
});
self.addEventListener("notificationclick", event => {
  event.notification.close();
  event.waitUntil((async () => {
    const raw=event.notification.data?.url || "/";
    const dest=new URL(raw,self.location.origin);
    const url=dest.origin===self.location.origin ? dest.href : self.location.origin + "/";
    const clientsList=await clients.matchAll({type:"window",includeUncontrolled:true});
    for(const client of clientsList) {
      if(client.url.startsWith(self.location.origin) && "focus" in client){
        await client.focus();
        if("navigate" in client) await client.navigate(url);
        return;
      }
    }
    if(clients.openWindow) await clients.openWindow(url);
  })());
});

/* Safe offline fallback: cache ONLY the public offline shell, never financial pages. */
const offlineCache="group-expense-offline-v1";
self.addEventListener("install",event=>{
  event.waitUntil(caches.open(offlineCache)
    .then(cache=>cache.add("/offline.html"))
    .then(()=>self.skipWaiting()));
});
self.addEventListener("activate",event=>{
  event.waitUntil(clients.claim());
});
self.addEventListener("fetch",event=>{
  if(event.request.mode!=="navigate")return;
  const url=new URL(event.request.url);
  if(url.origin!==self.location.origin)return;
  event.respondWith(fetch(event.request).catch(async()=>
    (await caches.open(offlineCache)).match("/offline.html") || Response.error()));
});
