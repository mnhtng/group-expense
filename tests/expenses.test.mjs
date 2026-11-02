import { test } from "node:test";
import assert from "node:assert/strict";
import { prepareExpense, parseVnd, ExpenseValidationError } from "../lib/expenses/domain.ts";

const members = ["A", "B", "C"];
function draft(overrides = {}) {
  return {
    title: "Đi chợ", notes: "", occurredOn: "2026-11-03", payerId: "A",
    items: [
      { name: "Gạo", quantity: 1, unitPriceMinor: "65000", participants: ["A", "B"] },
      { name: "Trứng", quantity: 1, unitPriceMinor: "65000", participants: ["A", "C"] },
    ],
    ...overrides,
  };
}
test("itemized receipt sums exact integer amounts", () => {
  const expense = prepareExpense(draft(), members);
  assert.equal(expense.totalMinor, "130000");
  assert.deepEqual(expense.items[0].shares, [{ userId: "A", amountMinor: "32500" }, { userId: "B", amountMinor: "32500" }]);
  assert.deepEqual(expense.items[1].shares, [{ userId: "A", amountMinor: "32500" }, { userId: "C", amountMinor: "32500" }]);
});
test("130k scenario: B owes 55k and C owes 65k, item shares traceable", () => {
  const e = draft({
    items: [
      { name: "B ăn", quantity: 1, unitPriceMinor: "55000", participants: ["B"] },
      { name: "C ăn", quantity: 1, unitPriceMinor: "65000", participants: ["C"] }
    ]
  });
  const result = prepareExpense(e, members);
  assert.equal(result.totalMinor, "130000");
  assert.deepEqual(result.items.map(i => i.shares), [
    [{userId:"B",amountMinor:"55000"}],[{userId:"C",amountMinor:"65000"}]
  ]);
});
test("3-way odd remainder deterministic, even when participant order changes", () => {
  const x = prepareExpense(draft({items:[{name:"X",quantity:1,unitPriceMinor:"100000",participants:["C","A","B"]}]}),members);
  assert.deepEqual(x.items[0].shares.map(z=>z.amountMinor),["33334","33333","33333"]);
});
test("allows exact per-member split with nonnegative shares", () => {
  const r = prepareExpense(draft({items:[{name:"X",quantity:2,unitPriceMinor:"65000",participants:["B","C"],
    shares:[{userId:"B",amountMinor:"55000"},{userId:"C",amountMinor:"75000"}]}]}),members);
  assert.equal(r.items[0].amountMinor,"130000");
});
test("rejects invalid amounts, members, rounding mistakes, dates, huge sums", () => {
  for(const s of ["1.5","-1","+1","01","NaN","Infinity","", "9223372036854775808"]) {
    assert.throws(()=>parseVnd(s,"price"),ExpenseValidationError);
  }
  assert.throws(()=>prepareExpense(draft({payerId:"outsider"}),members),ExpenseValidationError);
  assert.throws(()=>prepareExpense(draft({occurredOn:"2026-02-30"}),members),ExpenseValidationError);
  assert.throws(()=>prepareExpense(draft({items:[]}),members),ExpenseValidationError);
  assert.throws(()=>prepareExpense(draft({items:[{name:"X",quantity:1,unitPriceMinor:"100",participants:["A","X"]}]}),members),ExpenseValidationError);
  assert.throws(()=>prepareExpense(draft({items:[{name:"X",quantity:1,unitPriceMinor:"100",participants:["A","B"],shares:[{userId:"A",amountMinor:"99"},{userId:"B",amountMinor:"0"}]}]}),members),ExpenseValidationError);
  assert.throws(()=>prepareExpense(draft({items:[{name:"X",quantity:9999,unitPriceMinor:"9223372036854775807",participants:["A"]}]}),members),ExpenseValidationError);
});
