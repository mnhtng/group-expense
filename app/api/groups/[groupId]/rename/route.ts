import { NextResponse } from "next/server";
import { withAuthenticatedApi } from "@/lib/security/api-guards";
import { renameGroup } from "@/lib/groups/service";
import { optionalNote } from "@/lib/notes";

type Context={params:Promise<{groupId:string}>};
export const PATCH=withAuthenticatedApi<Context>(async(request,{params},user)=>{
  let payload:unknown;
  try { payload=await request.json(); }
  catch {return NextResponse.json({error:"Dữ liệu không hợp lệ."},{status:400});}
  const name=typeof payload==="object"&&payload!==null&&"name" in payload
    ? (payload as {name:unknown}).name : null;
  if(typeof name!=="string"||name.trim().length<2||name.trim().length>120)
    return NextResponse.json({error:"Tên nhóm phải có từ 2 đến 120 ký tự."},{status:400});
  let note: string | null | undefined;
  try { note = optionalNote(typeof payload==="object"&&payload!==null&&"note" in payload ? (payload as {note:unknown}).note : undefined); }
  catch { return NextResponse.json({error:"Ghi chú tối đa 1000 ký tự."},{status:400}); }
  try {
    const {groupId}=await params;
    await renameGroup(groupId,user.id,name,note??"");
    return NextResponse.json({name:name.trim(),notes:note});
  }catch(error){
    const message=error instanceof Error?error.message:"Không thể đổi tên nhóm.";
    return NextResponse.json({error:message},{status:/không có quyền/i.test(message)?403:500});
  }
});
