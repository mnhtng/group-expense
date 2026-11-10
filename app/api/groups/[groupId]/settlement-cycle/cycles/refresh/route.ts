import {NextResponse} from "next/server";
import {withAuthenticatedApi} from "@/lib/security/api-guards";
import {settlementBody,settlementError} from "@/lib/settlement-cycles/http";
import {refreshGroupCycleMetadata} from "@/lib/settlement-cycles/lifecycle";

type Context={params:Promise<{groupId:string}>};
export const POST=withAuthenticatedApi<Context>(async(request,{params},user)=>{
  try{
    await settlementBody(request,[]);
    const {groupId}=await params;
    return NextResponse.json({
      ...(await refreshGroupCycleMetadata(groupId,user.id)),
      metadataOnly:true,
    });
  }catch(cause){return settlementError(cause);}
});
