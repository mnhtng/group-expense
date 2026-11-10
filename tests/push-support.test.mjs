import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pushSupportReason, pushFailureMessage } from "../lib/notifications/push-support.ts";

const read = path => readFileSync(path,"utf8");
const base = {
  secure:true,serviceWorker:true,pushManager:true,notification:true,
  ios:false,standalone:false,brave:false,
};
test("iOS standalone PWA supports push, ordinary Safari tab needs Home Screen install",()=>{
  assert.equal(pushSupportReason({...base,ios:true,standalone:true}),null);
  assert.equal(pushSupportReason({...base,ios:true,standalone:false}),"ios-install");
  assert.equal(pushSupportReason({...base,ios:true,standalone:true,pushManager:false}),"ios-upgrade");
  assert.equal(pushSupportReason({...base,ios:true,standalone:true,secure:false}),"https-required");
  assert.equal(pushSupportReason({...base,ios:false,pushManager:false}),"unsupported");
  assert.equal(pushSupportReason(base),null);
});
test("Brave service failure has actionable privacy setting guidance",()=>{
  const problem=new Error("Registration failed - push service error");
  assert.match(pushFailureMessage(problem,{brave:true}),/brave:\/\/settings\/privacy/);
  assert.match(pushFailureMessage(problem,{brave:true}),/Google services for push messaging/);
  assert.doesNotMatch(pushFailureMessage(problem,{brave:false}),/brave:\/\//);
});
test("Permission default and denied never appear as the same generic error",()=>{
  const ui=read("components/notifications/push-settings.tsx");
  assert.match(ui,/present === "default"/);
  assert.match(ui,/present === "denied"/);
  assert.match(ui,/permission === "default"/);
  assert.match(ui,/const permissionPromise = Notification\.requestPermission\(\)/);
  assert.match(ui,/const pending = registration\.pushManager\.subscribe\(/);
  assert.match(ui,/Nhấn “Hoàn tất bật thông báo”/);
  assert.match(ui,/Kiểm tra lại quyền/);
  assert.match(ui,/Cài đặt iPhone/);
});
test("Subscription isn't shown as enabled until saved on authenticated server",()=>{
  const ui=read("components/notifications/push-settings.tsx");
  assert.match(ui,/\/api\/push\/subscriptions\/check/);
  assert.match(ui,/setSubscribed\(result\.saved\)/);
  const endpoint=read("app/api/push/subscriptions/check/route.ts");
  assert.match(endpoint,/getCurrentSession\(/);
  assert.match(endpoint,/hasSavedPushSubscription/);
  const store=read("lib/notifications/push-store.ts");
  assert.match(store,/WHERE user_id=\$1 AND endpoint=\$2 LIMIT 1/);
});

test("iOS push worker always displays a visible notification, even for bad payloads",()=>{
  const worker=read("public/sw.js");
  assert.match(worker,/event\.waitUntil\(/);
  assert.match(worker,/showNotification\(/);
  assert.match(worker,/Bạn có thông báo mới trong ứng dụng/);
  assert.doesNotMatch(worker,/if \(!event\.data\) return/);
  assert.doesNotMatch(worker,/catch\s*\{\s*return;\s*\}/);
});
