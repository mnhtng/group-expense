import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const read=path=>readFileSync(path,"utf8");

test("Saved, currently effective MANUAL schedule exposes a direct shortcut to the existing form",()=>{
  const schedule=read("components/groups/settlement-schedule-panel.tsx");
  const manage=read("app/(app)/groups/[groupId]/manage/page.tsx");
  const periods=read("components/groups/settlement-cycle-lifecycle-panel.tsx");
  assert.match(schedule,/activeManual=initial\.current\?\.frequency==="manual"/);
  assert.match(schedule,/initial\.canManage&&activeManual/);
  assert.match(schedule,/href=\{\`\/groups\/\$\{groupId\}\/manage\?section=periods#manual-cycle-form\`\}/);
  assert.match(schedule,/>\s*Tạo kỳ thủ công\s*<\/Link>/);
  assert.match(periods,/manualActive&&<div id="manual-cycle-form"/);
  assert.match(periods,/id="manual-cycle-form" className="scroll-mt-20/);
  assert.match(manage,/section==="periods"&&schedule&&cycles&&<SettlementCycleLifecyclePanel/);
  assert.doesNotMatch(schedule,/\/settlement-cycle\/cycles["\`]/);
});

test("Group opt-in rather than financial-engine rollout controls access to the manual form shortcut",()=>{
  const schedule=read("components/groups/settlement-schedule-panel.tsx");
  const manage=read("app/(app)/groups/[groupId]/manage/page.tsx");
  assert.match(manage,/requestedEnabled=\{settings\.requestedEnabled\}/);
  assert.match(schedule,/\{requestedEnabled\s*\?\s*<Link/);
  assert.match(schedule,/Nhóm chưa bật quyết toán/);
  assert.match(schedule,/href=\{\`\/groups\/\$\{groupId\}\/manage\?section=cycle\`\}/);
  assert.match(schedule,/Đến cài đặt quyết toán/);
  assert.doesNotMatch(schedule,/initial\.effectiveEnabled&&activeManual/);
  assert.doesNotMatch(schedule,/readEngineAccess|SETTLEMENT_CYCLE_ENGINE_READY\s*=\s*true/);
});

test("Pending or merely selected unsaved MANUAL configuration never unlocks the create shortcut",()=>{
  const schedule=read("components/groups/settlement-schedule-panel.tsx");
  assert.match(schedule,/pendingManual=initial\.pending\?\.frequency==="manual"/);
  assert.match(schedule,/initial\.canManage&&!activeManual&&pendingManual/);
  assert.match(schedule,/Lịch Thủ công đang chờ đến ngày bắt đầu/);
  assert.match(schedule,/activeManual=initial\.current\?\.frequency/);
  assert.doesNotMatch(schedule,/activeManual=frequency==="manual"/);
  assert.match(schedule,/Lưu lịch không tạo kỳ hoặc xác nhận thanh toán/);
});

test("Schedule navigation makes effective calendar versus disabled financial writes distinct",()=>{
  const schedule=read("components/groups/settlement-schedule-panel.tsx");
  const period=read("components/groups/settlement-cycle-lifecycle-panel.tsx");
  assert.match(schedule,/Lịch quyết toán đã có hiệu lực/);
  assert.match(schedule,/!initial\.effectiveEnabled&&/);
  assert.match(schedule,/Bù nợ và thanh toán theo kỳ chưa được hệ thống mở/);
  assert.match(period,/!requestedEnabled/);
  assert.match(period,/\bonClick=\{createManual\}/);
  assert.match(period,/Chuyển sang chờ kiểm tra/);
  assert.match(period,/Xác nhận xóa kỳ/);
  assert.match(read("lib/settlement-cycles/engine.ts"),/reason=!row\|\|row\.emergency_paused\?"paused"/);
  assert.doesNotMatch(schedule,/method:"POST"|method:"DELETE"|method:"PUT"/);
});
