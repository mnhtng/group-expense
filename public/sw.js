/* Financial data is network-only; cache a public offline fallback only. */
self.addEventListener("push", event => {
  // iOS WebKit requires a user-visible notification for every delivered push
  // event. Never swallow an empty/malformed payload: WebKit may revoke push
  // permission if a push event completes without showNotification().
  event.waitUntil((async () => {
    let payload = {
      title: "Group Expense",
      body: "Bạn có thông báo mới trong ứng dụng.",
      url: "/activity",
    };
    try {
      if (event.data) {
        const received = event.data.json();
        if (received && typeof received.title === "string" && received.title.trim()) {
          payload = {
            title: received.title,
            body: typeof received.body === "string" ? received.body : "",
            url: typeof received.url === "string" ? received.url : "/activity",
          };
        }
      }
    } catch { /* Use visible fallback for an invalid message. */ }
    let destination;
    try { destination = new URL(payload.url, self.location.origin); }
    catch { destination = new URL("/activity", self.location.origin); }
    const url = destination.origin === self.location.origin ? destination.href : self.location.origin + "/activity";
    await self.registration.showNotification(payload.title.slice(0, 160), {
      body: payload.body.slice(0, 500),
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
