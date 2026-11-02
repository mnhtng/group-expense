import assert from "node:assert/strict";
import { test } from "node:test";
import { allocateEvenly, sumMinorUnits } from "../lib/money.ts";

test("allocates all 100000 VND across 3 participants with stable remainder", () => {
  const allocation = allocateEvenly(100_000n, ["c", "b", "a"]);
  assert.deepEqual([...allocation.entries()], [
    ["a", 33_334n], ["b", 33_333n], ["c", 33_333n],
  ]);
  assert.equal(sumMinorUnits([...allocation.values()]), 100_000n);
});
test("one participant receives all minor units", () => {
  assert.deepEqual([...allocateEvenly(45_000n, ["b"])], [["b", 45_000n]]);
});
test("supports totals smaller than participant count", () => {
  assert.deepEqual([...allocateEvenly(1n, ["b", "a", "c"])], [
    ["a", 1n], ["b", 0n], ["c", 0n],
  ]);
});
test("supports zero and big integer amounts without float errors", () => {
  assert.equal(sumMinorUnits([...allocateEvenly(0n, ["a", "b"]).values()]), 0n);
  const amount = 9_000_000_000_000_000n;
  assert.equal(sumMinorUnits([...allocateEvenly(amount, ["a", "b", "c"]).values()]), amount);
});
test("rejects invalid participant lists and amounts", () => {
  assert.throws(() => allocateEvenly(-1n, ["a"]), RangeError);
  assert.throws(() => allocateEvenly(10n, []), RangeError);
  assert.throws(() => allocateEvenly(10n, ["a", "a"]), RangeError);
  assert.throws(() => allocateEvenly(10n, [" "]), RangeError);
  assert.throws(() => allocateEvenly(1, ["a"]), RangeError);
});
