import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const source=path=>readFileSync(path,"utf8");
const calendar=source("lib/settlement-cycles/schedule.ts");
const lifecycle=source("lib/settlement-cycles/lifecycle.ts");
const scheduleUi=source("components/groups/settlement-schedule-panel.tsx");
const cycleUi=source("components/groups/settlement-cycle-lifecycle-panel.tsx");

test("historic manual windows are derived from persisted revision boundaries, not a new schedule",()=>{
  assert.match(calendar,/const manualWindows:ManualScheduleWindow\[\]=revs\.rows\.flatMap/);
  assert.match(calendar,/rule\.frequency!=="manual"\|\|rule\.effectiveAt\.getTime\(\)>now/);
  assert.match(calendar,/endDateExclusive:revs\.rows\[next\]\?\.anchorDate\?\?null/);
  assert.match(calendar,/manualWindows,/);
  assert.doesNotMatch(calendar,/UPDATE group_settlement_cycles/);
});
test("creation selects an eligible past MANUAL revision, rejects recurring intervals and cutovers",()=>{
  assert.match(lifecycle,/schedule\.rules\.findLastIndex/);
  assert.match(lifecycle,/rule\.frequency!=="manual"/);
  assert.match(lifecycle,/input\.startDate<rule\.anchorDate/);
  assert.match(lifecycle,/start>=rule\.effectiveAt\.getTime\(\)/);
  assert.match(lifecycle,/start<next\.effectiveAt\.getTime\(\)/);
  assert.match(lifecycle,/Date\.parse\(endAt\)>next\.effectiveAt\.getTime\(\)/);
  assert.match(lifecycle,/addCycle\(client,groupId,rule,"manual"/);
  assert.match(lifecycle,/tstzrange\(start_at,end_at,'\[\)'\)/);
});
test("weekly UI exposes only allowed historic manual dates and keeps recurring refresh",()=>{
  assert.match(scheduleUi,/initial\.canManage&&historicManual/);
  assert.match(scheduleUi,/Tạo kỳ thủ công từ lịch cũ/);
  assert.match(cycleUi,/canCreateManual&&<div id="manual-cycle-form"/);
  assert.match(cycleUi,/manualWindows\.find\(window=>start>=window\.startDate/);
  assert.match(cycleUi,/start<window\.endDateExclusive/);
  assert.match(cycleUi,/validManualRange=Boolean\(matchingWindow/);
  assert.match(cycleUi,/end<=matchingWindow\.endDateExclusive/);
  assert.doesNotMatch(cycleUi,/Khoảng lịch Thủ công|windowIndex|chooseWindow/);
  assert.match(cycleUi,/Chỉ được tạo trong lịch Thủ công hoặc khoảng kỳ định kỳ đã hủy/);
  assert.match(cycleUi,/Khoảng ngày không được chồng lấn các kỳ đang hoạt động/);
  assert.match(cycleUi,/!manualActive&&<button/);
  assert.match(cycleUi,/expectedScheduleVersion:schedule\.version/);
  assert.match(cycleUi,/cycle\.state!=="locked"&&schedule\.canManage/);
  assert.match(cycleUi,/cycle\.source==="manual"&&<button/);
});

test("a cancelled recurring slot is explicitly reusable for a manual period, never silently overwritten",()=>{
  assert.match(calendar,/replacementWindows:replacements\.rows/);
  assert.match(calendar,/source='scheduled' AND cancelled_at IS NOT NULL/);
  assert.match(cycleUi,/\.\.\.schedule\.replacementWindows/);
  assert.match(cycleUi,/hủy kỳ đó trước/);
  assert.match(lifecycle,/schedule\.rules\.findIndex\(rule=>rule\.id===cancelled/);
  assert.match(lifecycle,/source='scheduled' AND cancelled_at IS NOT NULL/);
  assert.match(lifecycle,/Hãy hủy kỳ định kỳ chưa chốt trước khi chia thành kỳ thủ công/);
  assert.match(lifecycle,/Không thể sửa ra ngoài khoảng kỳ định kỳ đã hủy/);
  assert.match(lifecycle,/tstzrange\(start_at,end_at,'\[\)'\)/);
  assert.doesNotMatch(cycleUi,/windowIndex|chooseWindow/);
});

test("historic invoices predate the first manual schedule and consecutive revisions share one time-zone window",()=>{
  assert.match(calendar,/SELECT min\(occurred_on\)::text AS "firstDate" FROM expenses/);
  assert.match(calendar,/deleted_at IS NULL/);
  assert.match(calendar,/previous\?\.frequency==="manual"/);
  assert.match(calendar,/previous\.timeZone===rule\.timeZone/);
  assert.match(calendar,/const firstHistorical=/);
  assert.match(calendar,/index===0&&firstExpense&&firstExpense<rule\.anchorDate/);
  assert.match(lifecycle,/async function earliestLiveExpenseDate/);
  assert.match(lifecycle,/chosen<0&&firstRule\?\.frequency==="manual"/);
  assert.match(lifecycle,/input\.startDate>=earliest\)chosen=0/);
  assert.match(lifecycle,/nextManualBoundary\(schedule\.rules,chosen,now\)/);
  assert.match(lifecycle,/next\.frequency!=="manual"/);
  assert.match(lifecycle,/next\.timeZone!==rule\.timeZone/);
  assert.match(lifecycle,/next\.effectiveAt\.getTime\(\)>now/);
  assert.match(lifecycle,/Date\.parse\(endAt\)>next\.effectiveAt\.getTime\(\)/);
  assert.match(lifecycle,/tstzrange\(start_at,end_at,'\[\)'\)/);
  assert.doesNotMatch(calendar,/UPDATE expenses|UPDATE group_settlement_schedule_revisions/);
});
