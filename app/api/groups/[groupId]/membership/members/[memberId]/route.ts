import { NextResponse } from "next/server";
import { withAuthenticatedApi } from "@/lib/security/api-guards";
import { departGroup } from "@/lib/groups/membership";
import { membershipError } from "@/lib/groups/membership-http";
import { optionalNote } from "@/lib/notes";
type Ctx={params:Promise<{groupId:string;memberId:string}>};
export const DELETE=withAuthenticatedApi<Ctx>(async(request,{params},user)=>{
  const {groupId,memberId}=await params;
  if(!memberId || memberId.length>256)
    return NextResponse.json({error:"Thành viên không hợp lệ."},{status:400});
  let note:string|null;
  try{
    const raw=await request.text();
    const data:unknown=raw?JSON.parse(raw):{};
    note=optionalNote(data&&typeof data==="object"&&"note" in data?(data as {note:unknown}).note:undefined);
  }catch{return NextResponse.json({error:"Ghi chú không hợp lệ (tối đa 1000 ký tự)."},{status:400});}
  try{
    return NextResponse.json(await departGroup(groupId,user.id,memberId,"removed",note??""));
  }catch(error){return membershipError(error)}
});
