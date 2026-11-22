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
  assert.match(calendar,/endDateExclusive:revs\.rows\[index\+1\]\?\.anchorDate\?\?null/);
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
  assert.match(cycleUi,/validManualRange=Boolean\(selectedWindow/);
  assert.match(cycleUi,/end<=selectedWindow\.endDateExclusive/);
  assert.match(cycleUi,/Không chồng lấn các kỳ đã lưu/);
  assert.match(cycleUi,/!manualActive&&<button/);
  assert.match(cycleUi,/expectedScheduleVersion:schedule\.version/);
  assert.match(cycleUi,/cycle\.state==="open"&&cycle\.source==="manual"/);
});
