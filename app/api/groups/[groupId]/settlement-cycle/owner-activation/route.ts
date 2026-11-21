import {NextResponse} from "next/server";
import {withAuthenticatedApi} from "@/lib/security/api-guards";
import {settlementBody,settlementError} from "@/lib/settlement-cycles/http";
import {
  getOwnerEngineActivation,setOwnerEngineActivation,
} from "@/lib/settlement-cycles/owner-activation";

type Context={params:Promise<{groupId:string}>};
export const GET=withAuthenticatedApi<Context>(async(_req,{params},user)=>{
  try{
    return NextResponse.json(await getOwnerEngineActivation(
      (await params).groupId,user.id));
  }catch(error){return settlementError(error);}
});
export const PATCH=withAuthenticatedApi<Context>(async(request,{params},user)=>{
  try{
    const body=await settlementBody(request,[
      "enabled","expectedAdmitted","expectedControlRevision",
    ]);
    const result=await setOwnerEngineActivation((await params).groupId,user.id,{
      enabled:body.enabled as boolean,
      expectedAdmitted:body.expectedAdmitted as boolean,
      expectedControlRevision:body.expectedControlRevision as number,
    });
    return NextResponse.json(result);
  }catch(error){return settlementError(error);}
});
