import { NextResponse } from "next/server";
import { withAuthenticatedApi } from "@/lib/security/api-guards";
import { archiveGroup } from "@/lib/groups/service";
import { optionalNote } from "@/lib/notes";

type Context={params:Promise<{groupId:string}>};
export const POST=withAuthenticatedApi<Context>(async(request,{params},user)=>{
  let payload:unknown;
  try { payload=await request.json(); }
  catch {return NextResponse.json({error:"Dữ liệu không hợp lệ."},{status:400});}
  const confirmation=typeof payload==="object"&&payload!==null&&"confirmation" in payload
    ? (payload as {confirmation:unknown}).confirmation:null;
  if(typeof confirmation!=="string"||confirmation.length>120||!confirmation.trim())
    return NextResponse.json({error:"Hãy nhập đúng tên nhóm để xác nhận."},{status:400});
  let note: string | null;
  try { note = optionalNote(typeof payload==="object"&&payload!==null&&"note" in payload ? (payload as {note:unknown}).note : undefined); }
  catch { return NextResponse.json({error:"Ghi chú tối đa 1000 ký tự."},{status:400}); }
  try {
    await archiveGroup((await params).groupId,user.id,confirmation,note??"");
    return NextResponse.json({archived:true});
  }catch(error){
    const message=error instanceof Error?error.message:"Không thể lưu trữ nhóm.";
    return NextResponse.json({error:message},{status:409});
  }
});
