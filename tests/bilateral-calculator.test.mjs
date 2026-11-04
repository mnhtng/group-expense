import {test} from "node:test";
import assert from "node:assert/strict";
import {
  calculateBilateralSetoff,BilateralCalculationError,
} from "../lib/settlement-cycles/bilateral-calculator.ts";

// Stable UUIDs; no clock, database, randomness or auth state in this suite.
const id=n=>`00000000-0000-4000-8000-${n.toString(16).padStart(12,"0")}`;
const GROUP=id(1),CYCLE=id(2),A="person-a",B="person-b";
const input=(obligations=[],props={})=>({
  groupId:GROUP,cycleId:CYCLE,cycleState:"locked",
  periodStart:"2026-10-01",periodEnd:"2026-11-01",currency:"VND",
  partyAId:A,partyBId:B,obligations,...props,
});
const obligation=(n,debtor=A,creditor=B,props={})=>({
  obligationId:id(n),groupId:GROUP,cycleId:CYCLE,currency:"VND",
  debtorId:debtor,creditorId:creditor,
  occurredOn:"2026-10-01",snapshotExpenseVersion:1,
  currentExpenseVersion:1,inLockedCycleSnapshot:true,
  obligationVoided:false,expenseDeleted:false,
  originalMinor:"100",confirmedCashMinor:"0",pendingCashMinor:"0",
  confirmedSetoffMinor:"0",pendingSetoffMinor:"0",...props,
});
const check=(fn,code)=>{
  assert.throws(fn,e=>e instanceof BilateralCalculationError&&e.code===code);
};
const sumAlloc=rows=>rows.reduce((n,r)=>n+BigInt(r.setoffMinor),0n);
const byObligation=(rows)=>Object.fromEntries(rows.map(r=>[r.obligationId,r.setoffMinor]));
function deepFreeze(value){
  if(value&&typeof value==="object"){
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

test("BN-001 strict two-party, asymmetric debts, oldest date then UUID, exact pair conservation",()=>{
  const aEarly=obligation(11,A,B,{occurredOn:"2026-10-01",originalMinor:"80"});
  const aLate=obligation(12,A,B,{occurredOn:"2026-10-04",originalMinor:"40"});
  const bEarly=obligation(13,B,A,{occurredOn:"2026-10-02",originalMinor:"70"});
  const bLate=obligation(14,B,A,{occurredOn:"2026-10-05",originalMinor:"30"});
  const arg=deepFreeze(input([aLate,bLate,aEarly,bEarly]));
  const result=calculateBilateralSetoff(arg);
  assert.equal(result.kind,"BN-001_CALCULATION_ONLY");
  assert.equal(result.hasOffset,true);
  assert.equal(result.offsetMinor,"100");
  assert.deepEqual(result.aOwesB.allocations.map(r=>r.obligationId),
    [aEarly.obligationId,aLate.obligationId]);
  assert.deepEqual(result.aOwesB.allocations.map(r=>r.setoffMinor),["80","20"]);
  assert.deepEqual(result.bOwesA.allocations.map(r=>r.setoffMinor),["70","30"]);
  assert.equal(result.aOwesB.availableBeforeMinor,"120");
  assert.equal(result.aOwesB.availableAfterMinor,"20");
  assert.equal(result.bOwesA.availableBeforeMinor,"100");
  assert.equal(result.bOwesA.availableAfterMinor,"0");
  assert.equal(result.aOwesB.outstandingAfterHypotheticalSetoffMinor,"20");
  assert.equal(result.bOwesA.outstandingAfterHypotheticalSetoffMinor,"0");
  assert.equal(sumAlloc(result.aOwesB.allocations),100n);
  assert.equal(sumAlloc(result.bOwesA.allocations),100n);
  assert.equal(JSON.stringify(result).includes("setoffMinor"),true);
  assert.deepEqual(calculateBilateralSetoff(input([bEarly,aEarly,aLate,bLate])),result,
    "source iteration order must not change the allocation result");
  assert.equal(calculateBilateralSetoff(arg).offsetMinor,"100",
    "repeat calculations do not mutate frozen input");
});

test("BN-001 separates confirmed cash/setoff and BOTH pending reservation kinds",()=>{
  const result=calculateBilateralSetoff(input([
    obligation(21,A,B,{originalMinor:"1000",confirmedCashMinor:"300",
      pendingCashMinor:"200",confirmedSetoffMinor:"100",pendingSetoffMinor:"100"}),
    obligation(22,B,A,{originalMinor:"500",confirmedCashMinor:"50",
      confirmedSetoffMinor:"100",pendingSetoffMinor:"50"}),
  ]));
  assert.equal(result.offsetMinor,"300");
  assert.equal(result.aOwesB.outstandingMinor,"600");
  assert.equal(result.aOwesB.pendingReservedMinor,"300");
  assert.equal(result.aOwesB.availableBeforeMinor,"300");
  assert.equal(result.aOwesB.availableAfterMinor,"0");
  assert.equal(result.aOwesB.outstandingAfterHypotheticalSetoffMinor,"300",
    "pending cash is STILL outstanding, even after hypothetical offset");
  assert.equal(result.bOwesA.outstandingMinor,"350");
  assert.equal(result.bOwesA.pendingReservedMinor,"50");
  assert.equal(result.bOwesA.availableBeforeMinor,"300");
  assert.equal(result.bOwesA.outstandingAfterHypotheticalSetoffMinor,"50");
});

test("BN-001 swapping labels A and B swaps directions but preserves exact offset",()=>{
  const rows=[
    obligation(251,A,B,{originalMinor:"120",confirmedCashMinor:"10"}),
    obligation(252,B,A,{originalMinor:"90",pendingCashMinor:"20"}),
    obligation(253,A,B,{originalMinor:"10"}),
  ];
  const forward=calculateBilateralSetoff(input(rows));
  const swapped=calculateBilateralSetoff(input(rows,{
    partyAId:B,partyBId:A,
  }));
  assert.equal(forward.offsetMinor,"70");
  assert.equal(swapped.offsetMinor,forward.offsetMinor);
  assert.deepEqual(swapped.aOwesB,forward.bOwesA);
  assert.deepEqual(swapped.bOwesA,forward.aOwesB);
  assert.equal(forward.aOwesB.availableBeforeMinor,"120");
  assert.equal(forward.bOwesA.availableBeforeMinor,"70");
});

test("BN-001 rejected/cancelled pending cash frees reservation but never fakes confirmed cash",()=>{
  const old=[
    obligation(271,A,B,{originalMinor:"100",pendingCashMinor:"80"}),
    obligation(272,B,A,{originalMinor:"90"}),
  ];
  const pending=calculateBilateralSetoff(input(old));
  assert.equal(pending.offsetMinor,"20");
  assert.equal(pending.aOwesB.outstandingMinor,"100");
  const cancelled=calculateBilateralSetoff(input([
    {...old[0],pendingCashMinor:"0"},old[1],
  ]));
  assert.equal(cancelled.offsetMinor,"90");
  assert.equal(cancelled.aOwesB.outstandingMinor,"100",
    "cancelling a request does not lower outstanding");
  const confirmed=calculateBilateralSetoff(input([
    {...old[0],pendingCashMinor:"0",confirmedCashMinor:"80"},old[1],
  ]));
  assert.equal(confirmed.offsetMinor,"20");
  assert.equal(confirmed.aOwesB.outstandingMinor,"20",
    "confirmed cash actually reduces outstanding, unlike pending cash");
  assert.equal(confirmed.aOwesB.pendingReservedMinor,"0");
});

test("BN-001 pending allocations reserve, never discharge or synthesize offset",()=>{
  const result=calculateBilateralSetoff(input([
    obligation(31,A,B,{originalMinor:"100",pendingCashMinor:"100"}),
    obligation(32,B,A,{originalMinor:"500"}),
  ]));
  assert.equal(result.hasOffset,false);
  assert.equal(result.offsetMinor,"0");
  assert.deepEqual(result.aOwesB.allocations,[]);
  assert.deepEqual(result.bOwesA.allocations,[]);
  assert.equal(result.aOwesB.outstandingMinor,"100");
  assert.equal(result.aOwesB.pendingReservedMinor,"100");
  assert.equal(result.aOwesB.availableBeforeMinor,"0");
  assert.equal(result.bOwesA.availableAfterMinor,"500");
  assert.equal(result.bOwesA.outstandingAfterHypotheticalSetoffMinor,"500");
});

test("BN-001 zero, fully confirmed and one-direction-only periods",()=>{
  const empty=calculateBilateralSetoff(input());
  assert.equal(empty.offsetMinor,"0");
  assert.equal(empty.hasOffset,false);
  assert.deepEqual(empty.aOwesB.allocations,[]);
  assert.deepEqual(empty.bOwesA.allocations,[]);
  assert.equal(empty.aOwesB.obligationCount,0);
  const paid=calculateBilateralSetoff(input([
    obligation(41,A,B,{confirmedCashMinor:"100"}),
    obligation(42,B,A,{confirmedSetoffMinor:"100"}),
  ]));
  assert.equal(paid.aOwesB.outstandingMinor,"0");
  assert.equal(paid.bOwesA.outstandingMinor,"0");
  assert.equal(paid.offsetMinor,"0");
  const oneWay=calculateBilateralSetoff(input([obligation(43,A,B)]));
  assert.equal(oneWay.offsetMinor,"0");
  assert.equal(oneWay.aOwesB.availableAfterMinor,"100");
  assert.equal(oneWay.bOwesA.availableAfterMinor,"0");
});

test("BN-001 deterministic UUID tie-break and partial remainder on original obligation",()=>{
  const result=calculateBilateralSetoff(input([
    obligation(54,A,B,{originalMinor:"20",occurredOn:"2026-10-09"}),
    obligation(53,A,B,{originalMinor:"30",occurredOn:"2026-10-09"}),
    obligation(55,A,B,{originalMinor:"70",occurredOn:"2026-10-11"}),
    obligation(56,B,A,{originalMinor:"40",occurredOn:"2026-10-01"}),
  ]));
  assert.equal(result.offsetMinor,"40");
  assert.deepEqual(byObligation(result.aOwesB.allocations),{
    [id(53)]:"30",[id(54)]:"10",
  });
  assert.equal(result.aOwesB.allocations[1].availableAfterMinor,"10");
  assert.equal(result.aOwesB.availableAfterMinor,"80");
  assert.equal(result.aOwesB.allocations.some(r=>r.obligationId===id(55)),false);
});

test("BN-001 uses exact bigint far above Number.MAX_SAFE_INTEGER",()=>{
  const max="9223372036854775807";
  const result=calculateBilateralSetoff(input([
    obligation(60,A,B,{originalMinor:max}),
    obligation(61,A,B,{originalMinor:max}),
    obligation(62,B,A,{originalMinor:max}),
  ]));
  assert.equal(result.offsetMinor,max);
  assert.equal(result.aOwesB.availableBeforeMinor,"18446744073709551614");
  assert.equal(result.aOwesB.availableAfterMinor,max);
  assert.equal(result.bOwesA.availableBeforeMinor,max);
  assert.equal(sumAlloc(result.aOwesB.allocations),BigInt(max));
  assert.equal(sumAlloc(result.bOwesA.allocations),BigInt(max));
  assert.equal(result.aOwesB.allocations[0].setoffMinor,max);
  assert.equal(result.aOwesB.allocations.length,1);
  assert.equal(JSON.stringify(result).includes(max),true,
    "return value must serialize without BigInt JSON exception");
});

test("BN-001 rejects group, cycle, currency, third party, self and nonlocked scope",()=>{
  const good=obligation(70);
  for(const tampered of [
    {groupId:id(900)},{cycleId:id(901)},{currency:"USD"},
    {debtorId:"third-party"},{creditorId:"third-party"},
    {debtorId:A,creditorId:A},{debtorId:B,creditorId:B},
  ])check(()=>calculateBilateralSetoff(input([{...good,...tampered}])),
    "INVALID_SCOPE");
  for(const tampered of [
    {cycleState:"review"},{cycleState:"open"},{cycleState:"complete"},
    {currency:"USD"},{partyBId:A},{obligations:null},
    {periodStart:"2026-11-01"},{periodEnd:"2026-10-01"},
    {periodStart:"2026-02-30"},{periodEnd:"2026-13-01"},
  ])check(()=>calculateBilateralSetoff(input([good],tampered)),"INVALID_SCOPE");
  check(()=>calculateBilateralSetoff(null),"INVALID_INPUT");
  check(()=>calculateBilateralSetoff(input([null])),"INVALID_INPUT");
  check(()=>calculateBilateralSetoff(input([good,obligation(71,B,A),
    obligation(72,"person-c",A)])),"INVALID_SCOPE");
});

test("BN-001 exact local [start,end) period rejects older and end-boundary invoices",()=>{
  const first=obligation(730,A,B,{occurredOn:"2026-10-01"});
  const last=obligation(731,B,A,{occurredOn:"2026-10-31"});
  const good=calculateBilateralSetoff(input([first,last]));
  assert.equal(good.offsetMinor,"100");
  const invalid=[
    obligation(732,A,B,{occurredOn:"2026-09-30"}),
    obligation(733,B,A,{occurredOn:"2026-11-01"}),
  ];
  for(const o of invalid)check(
    ()=>calculateBilateralSetoff(input([first,last,o])),"INVALID_SCOPE");
  assert.equal(calculateBilateralSetoff(input([])).periodStart,"2026-10-01");
  assert.equal(calculateBilateralSetoff(input([])).periodEnd,"2026-11-01");
});

test("BN-001 rejects duplicate obligation IDs across both directions",()=>{
  check(()=>calculateBilateralSetoff(input([
    obligation(80),obligation(80,B,A),
  ])),"DUPLICATE_OBLIGATION");
  check(()=>calculateBilateralSetoff(input([
    obligation(81),obligation(81),
  ])),"DUPLICATE_OBLIGATION");
});

test("BN-001 fails closed for stale, voided, deleted or foreign invoice sources",()=>{
  const row=obligation(90);
  for(const change of [
    {inLockedCycleSnapshot:false},{inLockedCycleSnapshot:null},
    {obligationVoided:true},{expenseDeleted:true},
    {snapshotExpenseVersion:2},{snapshotExpenseVersion:0},
    {currentExpenseVersion:0},{currentExpenseVersion:1.5},
    {occurredOn:"2026-02-30"},{occurredOn:"2026-13-01"},
    {occurredOn:"0000-01-01"},
    {occurredOn:"2026-2-2"},{occurredOn:"2026-11-05T00:00:00Z"},
    {occurredOn:""},{occurredOn:null},
  ])check(()=>calculateBilateralSetoff(input([{...row,...change}])),
    "STALE_OR_INELIGIBLE_SOURCE");
});

test("BN-001 rejects every noncanonical, fractional and over-limit monetary input",()=>{
  const row=obligation(100);
  for(const key of [
    "originalMinor","confirmedCashMinor","pendingCashMinor",
    "confirmedSetoffMinor","pendingSetoffMinor",
  ])for(const bad of [
    -1,0,1,NaN,Infinity,1.1,0.1,12n,null,undefined,
    "","01","-1","-0","1.0","1e6"," 5","5 ","+5",
    "9223372036854775808","9999999999999999999999999999",
  ]){
    check(()=>calculateBilateralSetoff(input([{...row,[key]:bad}])),
      "INVALID_MONEY");
  }
  check(()=>calculateBilateralSetoff(input([
    obligation(101,{},{},{}),
  ])),"INVALID_SCOPE");
  check(()=>calculateBilateralSetoff(input([
    obligation(102,A,B,{originalMinor:"0"}),
  ])),"INVALID_MONEY");
  for(const changes of [
    {confirmedCashMinor:"70",confirmedSetoffMinor:"31"},
    {confirmedSetoffMinor:"101"},
    {pendingCashMinor:"50",pendingSetoffMinor:"51"},
    {confirmedCashMinor:"99",pendingCashMinor:"2"},
    {confirmedCashMinor:"50",confirmedSetoffMinor:"10",pendingCashMinor:"40",pendingSetoffMinor:"1"},
  ])check(()=>calculateBilateralSetoff(input([obligation(103,A,B,changes)])),
    "INVALID_MONEY");
});

test("BN-001 does not silently accept invalid IDs or missing state metadata",()=>{
  for(const props of [
    {groupId:""},{groupId:"G"},{cycleId:"not-a-uuid"},
    {partyAId:" "},{partyBId:" person-b "},
  ])check(()=>calculateBilateralSetoff(input([],props)),"INVALID_INPUT");
  const row=obligation(120);
  for(const changes of [
    {obligationId:"not-a-uuid"},{obligationId:123},
    {obligationVoided:undefined},{expenseDeleted:undefined},
  ]){
    check(()=>calculateBilateralSetoff(input([{...row,...changes}])),
      ["obligationVoided","expenseDeleted"].some(k=>k in changes)
        ?"STALE_OR_INELIGIBLE_SOURCE":"INVALID_INPUT");
  }
});

// Independent PRNG, no mocks or external dependencies. Always repeatable.
function randomGenerator(seed=0x7c1f230a){
  let x=seed>>>0;
  return ()=>{
    x^=x<<13;x^=x>>>17;x^=x<<5;
    return (x>>>0)/4294967296;
  };
}
function randint(rng,limit){return Math.floor(rng()*limit);}
function makeRandomObligation(n,debtor,creditor,rng){
  const original=BigInt(1+randint(rng,1000000));
  const cash=BigInt(randint(rng,Number(original)+1));
  const restAfterCash=original-cash;
  const setoff=BigInt(randint(rng,Number(restAfterCash)+1));
  const remaining=original-cash-setoff;
  const pendingCash=BigInt(randint(rng,Number(remaining)+1));
  const pendingSetoff=BigInt(randint(rng,Number(remaining-pendingCash)+1));
  return obligation(n,debtor,creditor,{
    occurredOn:`2026-10-${String(1+randint(rng,28)).padStart(2,"0")}`,
    originalMinor:original.toString(),confirmedCashMinor:cash.toString(),
    confirmedSetoffMinor:setoff.toString(),pendingCashMinor:pendingCash.toString(),
    pendingSetoffMinor:pendingSetoff.toString(),
  });
}

test("BN-001 1200 seeded property cases: both allocations = offset, every residual conserved",()=>{
  const rng=randomGenerator();
  for(let attempt=0;attempt<1200;attempt++){
    const countA=randint(rng,55),countB=randint(rng,55);
    const rows=[];
    for(let i=0;i<countA;i++)
      rows.push(makeRandomObligation(30000+i,A,B,rng));
    for(let i=0;i<countB;i++)
      rows.push(makeRandomObligation(40000+i,B,A,rng));
    const actual=calculateBilateralSetoff(input(rows));
    const a=actual.aOwesB,b=actual.bOwesA;
    const offset=BigInt(actual.offsetMinor);
    const expectedA=rows.filter(x=>x.debtorId===A)
      .reduce((n,x)=>n+BigInt(x.originalMinor)-
        BigInt(x.confirmedCashMinor)-BigInt(x.confirmedSetoffMinor)-
        BigInt(x.pendingCashMinor)-BigInt(x.pendingSetoffMinor),0n);
    const expectedB=rows.filter(x=>x.debtorId===B)
      .reduce((n,x)=>n+BigInt(x.originalMinor)-
        BigInt(x.confirmedCashMinor)-BigInt(x.confirmedSetoffMinor)-
        BigInt(x.pendingCashMinor)-BigInt(x.pendingSetoffMinor),0n);
    assert.equal(offset,expectedA<expectedB?expectedA:expectedB);
    assert.equal(sumAlloc(a.allocations),offset);
    assert.equal(sumAlloc(b.allocations),offset);
    assert.equal(BigInt(a.availableBeforeMinor)-BigInt(a.availableAfterMinor),offset);
    assert.equal(BigInt(b.availableBeforeMinor)-BigInt(b.availableAfterMinor),offset);
    assert.equal(BigInt(a.outstandingMinor)-BigInt(a.outstandingAfterHypotheticalSetoffMinor),offset);
    assert.equal(BigInt(b.outstandingMinor)-BigInt(b.outstandingAfterHypotheticalSetoffMinor),offset);
    assert.equal(BigInt(a.outstandingMinor)-BigInt(a.pendingReservedMinor),expectedA);
    assert.equal(BigInt(b.outstandingMinor)-BigInt(b.pendingReservedMinor),expectedB);
    for(const allocation of [...a.allocations,...b.allocations]){
      assert.ok(BigInt(allocation.setoffMinor)>0n);
      assert.ok(BigInt(allocation.setoffMinor)<=BigInt(allocation.availableBeforeMinor));
      assert.equal(BigInt(allocation.availableBeforeMinor),
        BigInt(allocation.setoffMinor)+BigInt(allocation.availableAfterMinor));
    }
    if(attempt%50===0){
      const shuffled=[...rows].reverse();
      assert.deepEqual(calculateBilateralSetoff(input(shuffled)),actual,
        "input permutation must not change deterministic settlement allocation");
    }
  }
});

test("BN-001 10,000 sources, no 50/500 UI cap, deterministic and aggregate-safe",()=>{
  const rng=randomGenerator(0x98fe1124);
  const rows=[];
  for(let i=0;i<10000;i++){
    const source=makeRandomObligation(100000+i,
      i%2===0?A:B,i%2===0?B:A,rng);
    rows.push(source);
  }
  const arg=input(rows);
  const first=calculateBilateralSetoff(arg);
  assert.equal(first.aOwesB.obligationCount,5000);
  assert.equal(first.bOwesA.obligationCount,5000);
  assert.equal(sumAlloc(first.aOwesB.allocations),BigInt(first.offsetMinor));
  assert.equal(sumAlloc(first.bOwesA.allocations),BigInt(first.offsetMinor));
  assert.equal(calculateBilateralSetoff(input([...rows].reverse())).offsetMinor,
    first.offsetMinor);
  assert.deepEqual(
    calculateBilateralSetoff(input([...rows].reverse())).aOwesB.allocations,
    first.aOwesB.allocations,
  );
  assert.equal(rows[0].obligationId,id(100000),"source rows are never sorted in place");
});
