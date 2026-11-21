/**
 * Display-only projections for the settlement-cycle finance UI.
 * Values are VND bigint decimal strings; NEVER authorize a financial write
 * from these previews. Services revalidate locked original obligations.
 */
type Direction={
  debtorId:string;creditorId:string;
  availableBeforeMinor:string;availableAfterMinor:string;
  pendingReservedMinor:string;
};
type BilateralPreview={
  calculation:{offsetMinor:string;aOwesB:Direction;bOwesA:Direction};
  current:{id:string}|null;
  completedSetoff?:{amountMinor:string;appliedAt:string}|null;
  cashStatus:{
    paidMinor:string;
    remainingMinor:string;
    pendingMinor:string;
    lowToHighRemainingMinor:string;
    highToLowRemainingMinor:string;
  };
};
export function summarizeBilateralPreview(preview:BilateralPreview){
  const {aOwesB:a,bOwesA:b,offsetMinor}=preview.calculation;
  const offset=BigInt(offsetMinor);
  const beforeA=BigInt(a.availableBeforeMinor),beforeB=BigInt(b.availableBeforeMinor);
  const afterA=BigInt(a.availableAfterMinor),afterB=BigInt(b.availableAfterMinor);
  const pending=BigInt(a.pendingReservedMinor)+BigInt(b.pendingReservedMinor);
  const residual=afterA>0n?afterA:afterB>0n?afterB:0n;
  const debtorId=afterA>0n?a.debtorId:afterB>0n?b.debtorId:null;
  const creditorId=afterA>0n?a.creditorId:afterB>0n?b.creditorId:null;
  const cash=preview.cashStatus;
  const cashPaid=BigInt(cash.paidMinor);
  const remainingDue=BigInt(cash.remainingMinor);
  const pendingCash=BigInt(cash.pendingMinor);
  const lowRemaining=BigInt(cash.lowToHighRemainingMinor);
  const highRemaining=BigInt(cash.highToLowRemainingMinor);
  // A cash payment is shown only after the other party has confirmed it.
  // An APPLIED noncash setoff is settlement, but NEVER proof of a cash transfer.
  const pairSettled=remainingDue===0n&&pendingCash===0n;
  const remainingDebtorId=lowRemaining>0n&&highRemaining===0n?a.debtorId:
    highRemaining>0n&&lowRemaining===0n?b.debtorId:null;
  const remainingCreditorId=lowRemaining>0n&&highRemaining===0n?a.creditorId:
    highRemaining>0n&&lowRemaining===0n?b.creditorId:null;
  return {
    offsetMinor:offset.toString(),
    beforeAMinor:beforeA.toString(),beforeBMinor:beforeB.toString(),
    afterAMinor:afterA.toString(),afterBMinor:afterB.toString(),
    pendingMinor:pending.toString(),residualMinor:residual.toString(),
    debtorId,creditorId,canOffset:offset>0n,
    // A completed noncash application is proof; no inference from zero balance.
    completedSetoff:preview.completedSetoff??null,
    hasCompletedSetoff:preview.completedSetoff!==null&&preview.completedSetoff!==undefined,
    appliedSetoffMinor:preview.completedSetoff?.amountMinor??null,
    cashPaidMinor:cashPaid.toString(),
    remainingDueMinor:remainingDue.toString(),
    confirmedCashPendingMinor:pendingCash.toString(),
    remainingDebtorId,remainingCreditorId,pairSettled,
    // Keep completed pairs visible even when there is no remaining two-way debt
    // or a later proposal head is absent.
    show:offset>0n||pending>0n||preview.current!==null||
      preview.completedSetoff!==null&&preview.completedSetoff!==undefined,
  };
}
export function cashActionCopy(debtorId:string,creditorId:string,actorId:string){
  if(actorId!==debtorId&&actorId!==creditorId)
    throw Error("Chỉ hai người liên quan được thao tác.");
  if(actorId===debtorId)return {
    label:"Báo đã chuyển tiền",
    explanation:"Chỉ chọn khi bạn đã chuyển tiền ngoài ứng dụng. Người nhận phải xác nhận đã nhận; hiện tại công nợ chưa giảm.",
    relation:"Bạn cần trả",
  };
  return {
    label:"Báo đã nhận tiền",
    explanation:"Chỉ chọn khi bạn đã thực nhận tiền ngoài ứng dụng. Người trả phải xác nhận đã chuyển; hiện tại công nợ chưa giảm.",
    relation:"Bạn cần thu",
  };
}
