import { NextResponse } from "next/server";
import { withAuthenticatedApi } from "@/lib/security/api-guards";
import { transferGroupOwnership } from "@/lib/groups/membership";
import { membershipError } from "@/lib/groups/membership-http";
import { optionalNote } from "@/lib/notes";
type Ctx={params:Promise<{groupId:string}>};
export const POST=withAuthenticatedApi<Ctx>(async(request,{params},user)=>{
  let body:unknown;
  try { body=await request.json(); }
  catch {return NextResponse.json({error:"JSON không hợp lệ."},{status:400})}
  const targetId=typeof body==="object" && body!==null && "targetId" in body
    ? (body as {targetId:unknown}).targetId : null;
  if(typeof targetId!=="string" || !targetId || targetId.length>256)
    return NextResponse.json({error:"Phải chọn thành viên hợp lệ."},{status:400});
  let note:string|null;
  try {note=optionalNote(body&&typeof body==="object"&&"note" in body?(body as {note:unknown}).note:undefined);}
  catch{return NextResponse.json({error:"Ghi chú tối đa 1000 ký tự."},{status:400});}
  try {
    return NextResponse.json(await transferGroupOwnership((await params).groupId,user.id,targetId,note??""));
  }catch(error){return membershipError(error)}
});
