import { NextResponse } from "next/server";
import { withAuthenticatedApi } from "@/lib/security/api-guards";
import { departGroup } from "@/lib/groups/membership";
import { membershipError } from "@/lib/groups/membership-http";
type Ctx={params:Promise<{groupId:string;memberId:string}>};
export const DELETE=withAuthenticatedApi<Ctx>(async(_request,{params},user)=>{
  const {groupId,memberId}=await params;
  if(!memberId || memberId.length>256)
    return NextResponse.json({error:"Thành viên không hợp lệ."},{status:400});
  try{
    return NextResponse.json(await departGroup(groupId,user.id,memberId,"removed"));
  }catch(error){return membershipError(error)}
});
