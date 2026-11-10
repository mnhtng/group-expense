import { NextResponse } from "next/server";
import { withAuthenticatedApi } from "@/lib/security/api-guards";
import { departGroup, getExitEligibility } from "@/lib/groups/membership";
import { membershipError } from "@/lib/groups/membership-http";
type Ctx={params:Promise<{groupId:string}>};
export const GET=withAuthenticatedApi<Ctx>(async (_request,{params},user)=>{
  try {
    const eligibility=await getExitEligibility((await params).groupId,user.id);
    if(!eligibility)return NextResponse.json({error:"Không tìm thấy nhóm."},{status:404});
    return NextResponse.json({eligibility});
  }catch(error){return membershipError(error)}
});
export const POST=withAuthenticatedApi<Ctx>(async (_request,{params},user)=>{
  try {
    const result=await departGroup((await params).groupId,user.id,user.id,"left");
    return NextResponse.json(result);
  }catch(error){return membershipError(error)}
});
