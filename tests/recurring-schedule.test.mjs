import { test } from "node:test";
import assert from "node:assert/strict";
import {
  dueDateOfMonth,dueDatesThrough,nextDueDate,
} from "../lib/recurring/schedule.ts";

test("monthly day 29/30/31 clamps to last calendar day",()=>{
  assert.equal(dueDateOfMonth(2026,2,31),"2026-02-28");
  assert.equal(dueDateOfMonth(2024,2,31),"2024-02-29");
  assert.equal(dueDateOfMonth(2026,4,31),"2026-04-30");
  assert.equal(dueDateOfMonth(2026,11,31),"2026-11-30");
  assert.equal(dueDateOfMonth(2026,12,31),"2026-12-31");
  assert.equal(dueDateOfMonth(2026,1,1),"2026-01-01");
  for(const day of [0,32,1.5,NaN])assert.throws(()=>dueDateOfMonth(2026,2,day));
});

test("template starts from effective date and does not bill past months",()=>{
  assert.deepEqual(dueDatesThrough("2026-11-04","2026-11-30",3),[]);
  assert.deepEqual(dueDatesThrough("2026-11-04","2026-12-04",3),[
    {period:"2026-12-01",date:"2026-12-03"},
  ]);
  assert.deepEqual(dueDatesThrough("2026-11-04","2026-12-04",4),[
    {period:"2026-11-01",date:"2026-11-04"},
    {period:"2026-12-01",date:"2026-12-04"},
  ]);
  assert.deepEqual(dueDatesThrough("2027-01-01","2026-12-31",1),[]);
  assert.deepEqual(dueDatesThrough("2026-11-30","2027-02-28",31),[
    {period:"2026-11-01",date:"2026-11-30"},
    {period:"2026-12-01",date:"2026-12-31"},
    {period:"2027-01-01",date:"2027-01-31"},
    {period:"2027-02-01",date:"2027-02-28"},
  ]);
});
test("next due is always current/future, stable across leap day",()=>{
  assert.equal(nextDueDate("2026-11-04",31,"2026-11-04"),"2026-11-30");
  assert.equal(nextDueDate("2026-11-04",3,"2026-11-04"),"2026-12-03");
  assert.equal(nextDueDate("2024-01-31",31,"2024-02-01"),"2024-02-29");
  assert.equal(nextDueDate("2026-11-04",4,"2026-11-05"),"2026-12-04");
  assert.throws(()=>dueDatesThrough("2026-02-30","2026-03-01",31));
});
