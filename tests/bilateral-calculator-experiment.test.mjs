import {test} from "node:test";
import assert from "node:assert/strict";
import {calculateBilateralSetoff} from "../lib/settlement-cycles/bilateral-calculator.ts";

const id=n=>`00000000-0000-4000-8000-${n.toString(16).padStart(12,"0")}`;
const groupId=id(1),cycleId=id(2);
const row=(n,debtorId,creditorId,day,originalMinor,changes={})=>({
  obligationId:id(n),groupId,cycleId,currency:"VND",debtorId,creditorId,
  occurredOn:`2026-11-${day}`,snapshotExpenseVersion:1,currentExpenseVersion:1,
  inLockedCycleSnapshot:true,obligationVoided:false,expenseDeleted:false,
  originalMinor,confirmedCashMinor:"0",pendingCashMinor:"0",
  confirmedSetoffMinor:"0",pendingSetoffMinor:"0",...changes,
});
const bills=[
  row(101,"A","B","01","140000",{confirmedCashMinor:"40000",pendingCashMinor:"20000"}),
  row(102,"A","B","02","90000"),
  row(103,"A","B","03","60000",{confirmedSetoffMinor:"10000",pendingSetoffMinor:"15000"}),
  row(201,"B","A","01","125000",{confirmedCashMinor:"25000"}),
  row(202,"B","A","02","80000",{pendingCashMinor:"30000"}),
  row(203,"B","A","03","45000",{confirmedSetoffMinor:"5000"}),
];
const scope={groupId,cycleId,cycleState:"locked",periodStart:"2026-11-01",
  periodEnd:"2026-11-08",currency:"VND",partyAId:"A",partyBId:"B"};

test("BN-001 experiment: six weekly dinner invoices conserve both sides",()=>{
  const actual=calculateBilateralSetoff({...scope,obligations:bills});
  assert.equal(actual.kind,"BN-001_CALCULATION_ONLY");
  assert.equal(actual.offsetMinor,"190000");
  assert.deepEqual([actual.aOwesB.outstandingMinor,
    actual.aOwesB.pendingReservedMinor,actual.aOwesB.availableBeforeMinor,
    actual.aOwesB.availableAfterMinor],["240000","35000","205000","15000"]);
  assert.deepEqual([actual.bOwesA.outstandingMinor,
    actual.bOwesA.pendingReservedMinor,actual.bOwesA.availableBeforeMinor,
    actual.bOwesA.availableAfterMinor],["220000","30000","190000","0"]);
  assert.deepEqual(actual.aOwesB.allocations.map(x=>x.setoffMinor),
    ["80000","90000","20000"]);
  assert.deepEqual(actual.bOwesA.allocations.map(x=>x.setoffMinor),
    ["100000","50000","40000"]);
  for(const side of [actual.aOwesB,actual.bOwesA])
    assert.equal(side.allocations.reduce((n,r)=>n+BigInt(r.setoffMinor),0n),190000n);
  assert.deepEqual(calculateBilateralSetoff({
    ...scope,obligations:[...bills].reverse(),
  }),actual,"input order must never change allocation");
  for(const sources of [
    [...bills,row(301,"C","A","04","500000")],
    bills.map((b,i)=>i===0?{...b,cycleId:id(90)}:b),
    bills.map((b,i)=>i===0?{...b,pendingCashMinor:"150000"}:b),
    bills.map((b,i)=>i===0?{...b,occurredOn:"2026-10-31"}:b),
  ])assert.throws(()=>calculateBilateralSetoff({...scope,obligations:sources}));
});
