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
  return {
    offsetMinor:offset.toString(),
    beforeAMinor:beforeA.toString(),beforeBMinor:beforeB.toString(),
    afterAMinor:afterA.toString(),afterBMinor:afterB.toString(),
    pendingMinor:pending.toString(),residualMinor:residual.toString(),
    debtorId,creditorId,canOffset:offset>0n,
    // Preserve access to pending/conflicted and historical proposal details.
    show:offset>0n||pending>0n||preview.current!==null,
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
