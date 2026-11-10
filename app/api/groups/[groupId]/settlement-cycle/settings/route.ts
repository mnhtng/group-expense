import { NextResponse } from "next/server";
import { withAuthenticatedApi } from "@/lib/security/api-guards";
import { settlementBody,settlementError } from "@/lib/settlement-cycles/http";
import {
  getSettlementSettings,updateSettlementSettings,
} from "@/lib/settlement-cycles/settings";

type Context={params:Promise<{groupId:string}>};
export const GET=withAuthenticatedApi<Context>(async(_request,{params},user)=>{
  try {
    return NextResponse.json(await getSettlementSettings((await params).groupId,user.id));
  } catch(error) {return settlementError(error);}
});
export const PATCH=withAuthenticatedApi<Context>(async(request,{params},user)=>{
  try {
    const body=await settlementBody(request,
      ["expectedVersion","requestedEnabled","requestedBilateralNetting"]);
    const result=await updateSettlementSettings((await params).groupId,user.id,{
      expectedVersion:body.expectedVersion as number,
      requestedEnabled:body.requestedEnabled as boolean,
      requestedBilateralNetting:body.requestedBilateralNetting as boolean,
    });
    return NextResponse.json(result);
  } catch(error) {return settlementError(error);}
});
