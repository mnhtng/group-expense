import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeNotificationFeed } from "../lib/notifications/merge-feed.ts";

test("background first-page polling preserves previously loaded older pages",()=>{
  const old=[{id:"5",readAt:null},{id:"4",readAt:null},{id:"3",readAt:null}];
  const latest=[{id:"6",readAt:null},{id:"5",readAt:"2026-11-03T00:00:00Z"}];
  assert.deepEqual(mergeNotificationFeed(old,latest).map(x=>x.id),["6","5","4","3"]);
  assert.equal(mergeNotificationFeed(old,latest)[1].readAt,"2026-11-03T00:00:00Z");
});
test("older-page requests append unseen results without duplicating cards",()=>{
  const current=[{id:"5"},{id:"4"},{id:"3"}];
  const older=[{id:"3"},{id:"2"},{id:"1"}];
  assert.deepEqual(mergeNotificationFeed(current,older,true).map(x=>x.id),
    ["5","4","3","2","1"]);
});
test("empty background updates never clear already mounted notifications",()=>{
  assert.deepEqual(mergeNotificationFeed([{id:"a"}],[]),[{id:"a"}]);
});
