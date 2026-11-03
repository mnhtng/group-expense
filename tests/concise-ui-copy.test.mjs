import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

function walk(dir){
  return readdirSync(dir,{withFileTypes:true}).flatMap(x=>{
    const p=path.join(dir,x.name);
    return x.isDirectory()?walk(p):/\.tsx$/.test(x.name)?[p]:[];
  });
}
const uiFiles=[...walk("app"),...walk("components")];
const source=(p)=>readFileSync(p,"utf8");
test("visible screens must not contain retired sprint announcements",()=>{
  for(const file of uiFiles){
    assert.doesNotMatch(source(file),/sẽ được bổ sung trong Sprint [0-9]+/i,file);
  }
});
test("financial confirmations remain clear after reducing interface copy",()=>{
  const actions=source("components/settlements/settlement-actions.tsx");
  const leave=source("components/groups/group-membership-manager.tsx");
  const expense=source("components/expenses/delete-expense-button.tsx");
  assert.match(actions,/Chỉ xác nhận khi đã thực sự chuyển hoặc nhận tiền/);
  assert.match(actions,/Công nợ không thay đổi/);
  assert.match(leave,/Cần tất toán công nợ trước khi rời/);
  assert.match(leave,/Lịch sử giao dịch vẫn được lưu/);
  assert.match(expense,/Không thể hoàn tác/);
});
test("high-priority pages avoid redundant explanatory footers",()=>{
  const pages=[
    "app/(app)/groups/[groupId]/page.tsx",
    "app/(app)/groups/[groupId]/manage/page.tsx",
    "app/(app)/debts/page.tsx",
  ];
  for(const file of pages){
    const text=source(file);
    assert.doesNotMatch(text,/Thành viên đã rời nhóm không thể tạo chi phí mới/i,file);
    assert.doesNotMatch(text,/Các khoản đối ứng chưa được cấn trừ/i,file);
    assert.doesNotMatch(text,/Khi thành viên rời nhóm, các khoản công nợ/i,file);
  }
});
