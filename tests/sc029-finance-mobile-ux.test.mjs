import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {summarizeBilateralPreview,cashActionCopy} from "../lib/settlement-cycles/finance-ux.ts";
const path="components/groups/settlement-cycle-finance-panel.tsx";
const view=readFileSync(path,"utf8");
function pair(a,b,aBefore,bBefore,pendingA="0",pendingB="0",hasDoc=false){
  const offset=BigInt(aBefore)<BigInt(bBefore)?BigInt(aBefore):BigInt(bBefore);
  return {current:hasDoc?{id:"proposal"}:null,
    calculation:{offsetMinor:offset.toString(),
      aOwesB:{debtorId:a,creditorId:b,availableBeforeMinor:aBefore,
        availableAfterMinor:(BigInt(aBefore)-offset).toString(),pendingReservedMinor:pendingA},
      bOwesA:{debtorId:b,creditorId:a,availableBeforeMinor:bBefore,
        availableAfterMinor:(BigInt(bBefore)-offset).toString(),pendingReservedMinor:pendingB}}};
}
test("pair preview shows 168667 vs 23333 -> 145334 residual without floating point",()=>{
  const x=summarizeBilateralPreview(pair("Dang","Tung","168667","23333"));
  assert.equal(x.offsetMinor,"23333");
  assert.equal(x.afterAMinor,"145334");
  assert.equal(x.afterBMinor,"0");
  assert.equal(x.residualMinor,"145334");
  assert.equal(x.debtorId,"Dang");
  assert.equal(x.creditorId,"Tung");
  assert.equal(x.show,true);
});
test("second pair is also discoverable, independent of selected default member",()=>{
  const a=summarizeBilateralPreview(pair("Tung","Dang","23333","168667"));
  const b=summarizeBilateralPreview(pair("Tung","Hien","120000","43666"));
  assert.equal(a.offsetMinor,"23333");
  assert.equal(b.offsetMinor,"43666");
  assert.equal(b.residualMinor,"76334");
  assert.equal(b.debtorId,"Tung");
});
test("pending cash is not counted as paid or made available for setoff",()=>{
  const x=summarizeBilateralPreview(pair("A","B","0","30000","100000","0"));
  assert.equal(x.offsetMinor,"0");
  assert.equal(x.pendingMinor,"100000");
  assert.equal(x.residualMinor,"30000");
  assert.equal(x.show,true);
});
test("single-direction pair without pending/history is omitted; historical proposal remains accessible",()=>{
  assert.equal(summarizeBilateralPreview(pair("A","B","0","50000")).show,false);
  assert.equal(summarizeBilateralPreview(pair("A","B","0","0","0","0",true)).show,true);
});
test("cash wording reflects authenticated debtor or creditor regardless of obligation count",()=>{
  assert.equal(cashActionCopy("A","B","A").label,"Báo đã chuyển tiền");
  assert.equal(cashActionCopy("A","B","B").label,"Báo đã nhận tiền");
  assert.throws(()=>cashActionCopy("A","B","C"));
});
test("finance UI discovers all counterparts, stays actor-scoped, and preserves safety",()=>{
  assert.match(view,/function BilateralPairList/);
  assert.match(view,/counterparts\.map|counterparts\[cursor\+\+\]/);
  assert.match(view,/partyAId:me,partyBId:member\.id/);
  assert.match(view,/summarizeBilateralPreview/);
  assert.match(view,/pendingMinor/);
  assert.match(view,/beforeAMinor/);
  assert.match(view,/beforeBMinor/);
  assert.match(view,/residualMinor/);
  assert.match(view,/\/settlements/);
  assert.match(view,/cashActionCopy/);
  assert.match(view,/const financeReady=financialEngineEnabled&&requestedEnabled/);
  assert.match(view,/disabled=\{!enabled\|\|Boolean\(sending\)\}/);
  assert.doesNotMatch(view,/<details|window\.confirm|financialEngineEnabled\s*=\s*true/i);
});
