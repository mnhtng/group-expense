import {test} from "node:test";
import assert from "node:assert/strict";
import {calculateBilateralSetoff,BilateralCalculationError}
  from "../lib/settlement-cycles/bilateral-calculator.ts";

// SC-007 independent seed-based property/model suite. No network, mocks,
// ORM, external property-testing dependency, or nondeterministic clock.
// Reproduce failures with the printed seed and trial number.
const group="00000000-0000-4000-8000-000000000001";
const cycle="00000000-0000-4000-8000-000000000002";
const A="sc007-a",B="sc007-b";
const id=(n)=>`00000000-0000-4000-8000-${n.toString(16).padStart(12,"0")}`;
const base=(rows,extra={})=>({groupId:group,cycleId:cycle,
  cycleState:"locked",periodStart:"2026-10-01",periodEnd:"2026-11-01",
  currency:"VND",partyAId:A,partyBId:B,obligations:rows,...extra});
const seedRng=(seed)=>()=>{seed^=seed<<13;seed^=seed>>>17;
  seed^=seed<<5;return seed>>>0};
const random=(rng,n)=>rng()%n;
const sum=(xs,key)=>xs.reduce((n,r)=>n+BigInt(r[key]),0n);
const min=(a,b)=>a<b?a:b;
const row=(n,dir,original,cash,pending,setoff,pendingSetoff,date)=>({
  obligationId:id(n),groupId:group,cycleId:cycle,currency:"VND",
  debtorId:dir===0?A:B,creditorId:dir===0?B:A,
  occurredOn:date,snapshotExpenseVersion:1,currentExpenseVersion:1,
  inLockedCycleSnapshot:true,obligationVoided:false,expenseDeleted:false,
  originalMinor:String(original),confirmedCashMinor:String(cash),
  pendingCashMinor:String(pending),confirmedSetoffMinor:String(setoff),
  pendingSetoffMinor:String(pendingSetoff),
});
const made=(rng,n,dir)=> {
  const original=BigInt(1+random(rng,1_000_000));
  const cash=BigInt(random(rng,Number(original+1n)));
  const setoff=BigInt(random(rng,Number(original-cash+1n)));
  const outstanding=original-cash-setoff;
  const pending=BigInt(random(rng,Number(outstanding+1n)));
  const pendingSetoff=BigInt(random(rng,Number(outstanding-pending+1n)));
  return row(n,dir,original,cash,pending,setoff,pendingSetoff,
    `2026-10-${String(1+random(rng,31)).padStart(2,"0")}`);
};
const sourceDue=(r)=>BigInt(r.originalMinor)-BigInt(r.confirmedCashMinor)-
  BigInt(r.confirmedSetoffMinor);
const sourceAvailable=(r)=>sourceDue(r)-BigInt(r.pendingCashMinor)-
  BigInt(r.pendingSetoffMinor);
const directions=(rows)=>[
  rows.filter(r=>r.debtorId===A),
  rows.filter(r=>r.debtorId===B),
];
function verify(recs,iteration){
  const [a,b]=directions(recs);
  const available=[a,b].map(s=>s.reduce((n,r)=>n+sourceAvailable(r),0n));
  const outstanding=[a,b].map(s=>s.reduce((n,r)=>n+sourceDue(r),0n));
  const reserved=[a,b].map(s=>s.reduce((n,r)=>n+BigInt(r.pendingCashMinor)+
    BigInt(r.pendingSetoffMinor),0n));
  const offset=min(...available);
  const snapshot=JSON.stringify(recs);
  const input=base(recs);
  const result=calculateBilateralSetoff(input);
  assert.equal(JSON.stringify(recs),snapshot,`trial ${iteration}: input mutated`);
  assert.equal(result.offsetMinor,offset.toString(),`trial ${iteration}`);
  assert.equal(result.hasOffset,offset>0n);
  assert.deepEqual([result.aOwesB.availableBeforeMinor,
    result.bOwesA.availableBeforeMinor],available.map(String));
  assert.deepEqual([result.aOwesB.outstandingMinor,
    result.bOwesA.outstandingMinor],outstanding.map(String));
  assert.deepEqual([result.aOwesB.pendingReservedMinor,
    result.bOwesA.pendingReservedMinor],reserved.map(String));
  for(const [i,dir] of [result.aOwesB,result.bOwesA].entries()){
    assert.equal(sum(dir.allocations,"setoffMinor"),offset,`trial ${iteration}`);
    assert.equal(BigInt(dir.availableAfterMinor),available[i]-offset);
    assert.equal(BigInt(dir.outstandingAfterHypotheticalSetoffMinor),
      outstanding[i]-offset);
    const seen=new Set();
    const ordered=[...dir.allocations].sort((x,y)=>
      x.occurredOn.localeCompare(y.occurredOn)||
      x.obligationId.localeCompare(y.obligationId));
    assert.deepEqual(dir.allocations,ordered,"FIFO must always be stable");
    for(const alloc of dir.allocations){
      assert.equal(seen.has(alloc.obligationId),false);
      seen.add(alloc.obligationId);
      const original=recs.find(r=>r.obligationId===alloc.obligationId);
      assert.ok(original);
      assert.ok(BigInt(alloc.setoffMinor)>0n);
      assert.ok(BigInt(alloc.setoffMinor)<=sourceAvailable(original));
      assert.equal(BigInt(alloc.availableAfterMinor),
        sourceAvailable(original)-BigInt(alloc.setoffMinor));
    }
  }
  // Metamorphic: pair-label swap changes directions, NOT money,
  // regardless of bytewise ID sort and source input order.
  const swapped=calculateBilateralSetoff(base(recs,{partyAId:B,partyBId:A}));
  assert.equal(swapped.offsetMinor,result.offsetMinor);
  assert.deepEqual(swapped.aOwesB,result.bOwesA);
  assert.deepEqual(swapped.bOwesA,result.aOwesB);
  const reversed=calculateBilateralSetoff(base([...recs].reverse()));
  assert.deepEqual(reversed,result);
  // Confirmed *setoff* is NONCASH: it discharges exact equal amounts
  // from both directional outstanding sums, without ever changing
  // existing confirmed cash, pending reservations or original IDs.
  const allocated=new Map([...result.aOwesB.allocations,
    ...result.bOwesA.allocations].map(x=>[x.obligationId,BigInt(x.setoffMinor)]));
  const applied=recs.map(r=>({...r,confirmedSetoffMinor:
    String(BigInt(r.confirmedSetoffMinor)+(allocated.get(r.obligationId)??0n))}));
  for(const r of applied)assert.ok(sourceAvailable(r)>=0n);
  for(const [i,side] of directions(applied).entries()){
    assert.equal(side.reduce((n,r)=>n+sourceDue(r),0n),outstanding[i]-offset);
    assert.equal(side.reduce((n,r)=>n+sourceAvailable(r),0n),available[i]-offset);
  }
  assert.equal(sum(applied,"confirmedCashMinor"),sum(recs,"confirmedCashMinor"),
    "applied NONCASH cannot forge a cash receipt");
}

test("SC-007 model: 1,500 reproducible random balance/offset/FIFO/permutation cases",()=>{
  const rng=seedRng(0x55000719);
  for(let trial=0;trial<1500;trial++){
    const count=1+random(rng,40);
    const rows=[];
    for(let i=0;i<count;i++)rows.push(made(rng,trial*50+i+1,random(rng,2)));
    verify(rows,trial);
  }
});
test("SC-007 model: 10,000 sources, >50 allocations and exact large VND",()=>{
  const huge=9007199254740991n;
  const rows=[];
  for(let i=1;i<=10000;i++){
    const dir=i%2;
    const value=i===1||i===2?huge:BigInt(1+i%41);
    rows.push(row(i,dir,value,0n,0n,0n,0n,
      `2026-10-${String(1+i%30).padStart(2,"0")}`));
  }
  const result=calculateBilateralSetoff(base(rows));
  assert.equal(result.offsetMinor,min(
    sum(rows.filter(x=>x.debtorId===A),"originalMinor"),
    sum(rows.filter(x=>x.debtorId===B),"originalMinor")).toString());
  assert.ok(result.aOwesB.allocations.length>50);
  assert.ok(result.bOwesA.allocations.length>50);
  assert.equal(sum(result.aOwesB.allocations,"setoffMinor"),
    BigInt(result.offsetMinor));
  assert.equal(sum(result.bOwesA.allocations,"setoffMinor"),
    BigInt(result.offsetMinor));
  assert.equal(result.currency,"VND");
});
test("SC-007 model: adversarial float, overflow, negative, cross-pair or duplicate sources fail CLOSED",()=>{
  const good=[row(1,0,100n,0n,0n,0n,0n,"2026-10-05"),
    row(2,1,100n,0n,0n,0n,0n,"2026-10-06")];
  for(const [i,field,val,code] of [
    [0,"confirmedCashMinor","101","INVALID_MONEY"],
    [0,"pendingCashMinor","101","INVALID_MONEY"],
    [0,"originalMinor","1.0","INVALID_MONEY"],
    [0,"originalMinor","9223372036854775808","INVALID_MONEY"],
    [1,"confirmedSetoffMinor","-1","INVALID_MONEY"],
    [1,"creditorId","outsider","INVALID_SCOPE"],
    [1,"groupId",id(999),"INVALID_SCOPE"],
    [1,"cycleId",id(999),"INVALID_SCOPE"],
    [1,"inLockedCycleSnapshot",false,"STALE_OR_INELIGIBLE_SOURCE"],
    [1,"obligationVoided",true,"STALE_OR_INELIGIBLE_SOURCE"],
    [1,"currentExpenseVersion",2,"STALE_OR_INELIGIBLE_SOURCE"],
  ]){
    const input=good.map((r,j)=>j===i?{...r,[field]:val}:r);
    assert.throws(()=>calculateBilateralSetoff(base(input)),
      e=>e instanceof BilateralCalculationError&&e.code===code);
  }
  assert.throws(()=>calculateBilateralSetoff(base([...good,good[0]])),
    e=>e instanceof BilateralCalculationError&&e.code==="DUPLICATE_OBLIGATION");
  assert.throws(()=>calculateBilateralSetoff(base(good,{
    partyBId:A})),e=>e.code==="INVALID_SCOPE");
});
