import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const group=readFileSync("app/(app)/groups/[groupId]/page.tsx","utf8");
const detail=readFileSync("app/(app)/groups/[groupId]/cycles/[cycleId]/page.tsx","utf8");

test("all group members can discover the cycle section from the group home",()=>{
  assert.match(group,/SegmentedNav label="Trong nhóm"/);
  assert.match(group,/href:base\+"\/cycles",label:"Quyết toán",active:false/);
  assert.match(group,/getMemberRole\(groupId,user\.id\)/);
  assert.doesNotMatch(group,/UPDATE group_settlement_cycles|financial_engine_enabled\s*=/);
});
test("OPEN and REVIEW explain why settlement tabs are not shown",()=>{
  assert.match(detail,/Kỳ đang mở\. Bù nợ và Trả tiền theo kỳ chỉ mở sau khi kỳ được kiểm tra và chốt số liệu/);
  assert.match(detail,/Kiểm tra và chốt số liệu để mở Bù nợ và Trả tiền theo kỳ/);
  assert.match(detail,/Chờ chủ nhóm hoặc người quản lý chốt số liệu/);
  assert.match(detail,/Quyết toán đang tắt\. Chủ nhóm hoặc người quản lý cần bật lại/);
});
test("no financial action is unlocked by the discoverability change",()=>{
  assert.match(detail,/const locked=selected\.state==="locked"/);
  assert.match(detail,/\{locked&&view==="settle"&&!selected\.settlementCompletedAt&&/);
  assert.match(detail,/canManage=\{settings\.canManage&&settings\.requestedEnabled\}/);
  assert.match(detail,/financialEngineEnabled=\{settings\.effectiveEnabled\}/);
  assert.doesNotMatch(detail,/SET .*financial_engine_enabled|UPDATE .*financial_engine_enabled|financialEngineEnabled=\{true\}/);
});
