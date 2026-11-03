import { NextResponse } from "next/server";
import { withAuthenticatedApi } from "@/lib/security/api-guards";
import { acceptInvite } from "@/lib/groups/service";
import { optionalNote } from "@/lib/notes";
export const POST=withAuthenticatedApi(async(request,_context,user)=>{
  let data:unknown;
  try{data=await request.json();}catch{return NextResponse.json({error:"JSON không hợp lệ."},{status:400})}
  const token=typeof data==="object"&&data!==null&&"token" in data
    ? (data as {token:unknown}).token : null;
  if(typeof token!=="string" || !/^[A-Za-z0-9_-]{32,100}$/.test(token))
    return NextResponse.json({error:"Liên kết không hợp lệ."},{status:400});
  let note: string | null;
  try { note = optionalNote(typeof data==="object"&&data!==null&&"note" in data ? (data as {note:unknown}).note : undefined); }
  catch { return NextResponse.json({error:"Ghi chú tối đa 1000 ký tự."},{status:400}); }
  try {
    const groupId=await acceptInvite(user.id,token,note??"");
    return NextResponse.json({groupId});
  }catch(error){
    return NextResponse.json({error:error instanceof Error?error.message:"Không thể tham gia nhóm."},
      {status:409});
  }
});
