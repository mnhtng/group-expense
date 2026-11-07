import {test} from "node:test";
import assert from "node:assert/strict";
import {
  addCalendarDays,CYCLE_FREQUENCIES,currentLocalDate,
  isPeriodBoundary,localMidnightInstant,periodContaining,validLocalDate,
} from "../lib/settlement-cycles/calendar.ts";

test("SC-002 exact [start,end) anchored weekly and biweekly boundaries",()=>{
  assert.deepEqual(CYCLE_FREQUENCIES,["weekly","biweekly","monthly","manual"]);
  assert.deepEqual(periodContaining("2026-11-08","weekly","2026-11-02"),
    {start:"2026-11-02",end:"2026-11-09"});
  assert.deepEqual(periodContaining("2026-11-09","weekly","2026-11-02"),
    {start:"2026-11-09",end:"2026-11-16"});
  assert.deepEqual(periodContaining("2026-11-22","biweekly","2026-11-09"),
    {start:"2026-11-09",end:"2026-11-23"});
  assert.deepEqual(periodContaining("2026-11-23","biweekly","2026-11-09"),
    {start:"2026-11-23",end:"2026-12-07"});
  assert.equal(isPeriodBoundary("2026-11-23","biweekly","2026-11-09"),true);
  assert.equal(isPeriodBoundary("2026-11-16","biweekly","2026-11-09"),false);
  assert.equal(isPeriodBoundary("2026-11-09","weekly","2026-11-02"),true);
  assert.equal(isPeriodBoundary("2026-11-08","weekly","2026-11-02"),false);
  assert.equal(isPeriodBoundary("2026-11-02","weekly","2026-11-02"),true);
  assert.equal(isPeriodBoundary("2026-11-01","weekly","2026-11-02"),false);
  assert.equal(periodContaining("2026-11-01","weekly","2026-11-02"),null);
});

test("SC-002 monthly anchor 29/30/31 clamps without drifting across years",()=>{
  const anchor="2026-01-31";
  assert.deepEqual(periodContaining("2026-02-27","monthly",anchor),
    {start:"2026-01-31",end:"2026-02-28"});
  assert.deepEqual(periodContaining("2026-02-28","monthly",anchor),
    {start:"2026-02-28",end:"2026-03-31"});
  assert.deepEqual(periodContaining("2026-03-31","monthly",anchor),
    {start:"2026-03-31",end:"2026-04-30"});
  assert.deepEqual(periodContaining("2024-02-29","monthly","2024-01-31"),
    {start:"2024-02-29",end:"2024-03-31"});
  assert.deepEqual(periodContaining("2027-02-28","monthly","2026-01-31"),
    {start:"2027-02-28",end:"2027-03-31"});
  assert.equal(isPeriodBoundary("2026-02-28","monthly",anchor),true);
  assert.equal(isPeriodBoundary("2026-03-01","monthly",anchor),false);
  assert.equal(isPeriodBoundary("2026-04-30","monthly",anchor),true);
});

test("SC-002 manual frequency never manufactures automatic periods",()=>{
  assert.equal(periodContaining("2026-12-01","manual","2026-11-02"),null);
  assert.equal(isPeriodBoundary("2026-12-03","manual","2026-11-02"),true);
  assert.equal(isPeriodBoundary("2026-11-01","manual","2026-11-02"),false);
});

test("SC-002 ISO dates are exact calendar days (no Feb 30 or local drifting)",()=>{
  assert.equal(addCalendarDays("2024-02-28",1),"2024-02-29");
  assert.equal(addCalendarDays("2024-02-29",1),"2024-03-01");
  assert.equal(addCalendarDays("2026-12-31",1),"2027-01-01");
  for(const day of ["2026-02-29","2026-02-30","2026-00-03","2026-13-01",
    "2026-11-31","11/4/2026","2026-1-1","0000-01-01","2026-01-01T00:00:00Z"]) {
    assert.throws(()=>validLocalDate(day),day);
  }
  assert.throws(()=>periodContaining("2026-11-04","bad","2026-11-02"));
  assert.throws(()=>addCalendarDays("2026-11-04",1.5));
});

test("SC-002 IANA boundary resolves UTC instant exactly and handles DST",()=>{
  assert.equal(localMidnightInstant("2026-11-05","Asia/Ho_Chi_Minh"),
    "2026-11-04T17:00:00.000Z");
  assert.equal(localMidnightInstant("2026-11-05","Asia/Bangkok"),
    "2026-11-04T17:00:00.000Z");
  assert.equal(localMidnightInstant("2026-11-05","UTC"),
    "2026-11-05T00:00:00.000Z");
  assert.equal(localMidnightInstant("2026-11-05","America/New_York"),
    "2026-11-05T05:00:00.000Z");
  assert.equal(localMidnightInstant("2026-07-01","America/New_York"),
    "2026-07-01T04:00:00.000Z");
  assert.equal(currentLocalDate("Asia/Ho_Chi_Minh",
    Date.parse("2026-11-04T18:30:00.000Z")),"2026-11-05");
  assert.throws(()=>localMidnightInstant("2026-11-05","Fake/Zone"));
  assert.throws(()=>localMidnightInstant("2026-11-05","UTC;DROP TABLE groups"));
  assert.throws(()=>localMidnightInstant("2011-12-30","Pacific/Apia"),
    /không tồn tại|bị lặp/);
});
