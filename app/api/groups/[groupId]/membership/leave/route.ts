import { NextResponse } from "next/server";
import { withAuthenticatedApi } from "@/lib/security/api-guards";
import { departGroup, getExitEligibility } from "@/lib/groups/membership";
import { membershipError } from "@/lib/groups/membership-http";
import { optionalNote } from "@/lib/notes";
type Ctx={params:Promise<{groupId:string}>};
export const GET=withAuthenticatedApi<Ctx>(async (_request,{params},user)=>{
  try {
    const eligibility=await getExitEligibility((await params).groupId,user.id);
    if(!eligibility)return NextResponse.json({error:"Không tìm thấy nhóm."},{status:404});
    return NextResponse.json({eligibility});
  }catch(error){return membershipError(error)}
});
export const POST=withAuthenticatedApi<Ctx>(async (request,{params},user)=>{
  let note:string|null;
  try {
    const raw=await request.text();
    const data:unknown=raw?JSON.parse(raw):{};
    note=optionalNote(data&&typeof data==="object"&&"note" in data?(data as {note:unknown}).note:undefined);
  }catch{return NextResponse.json({error:"Ghi chú không hợp lệ (tối đa 1000 ký tự)."},{status:400});}
  try {
    const result=await departGroup((await params).groupId,user.id,user.id,"left",note??"");
    return NextResponse.json(result);
  }catch(error){return membershipError(error)}
});
