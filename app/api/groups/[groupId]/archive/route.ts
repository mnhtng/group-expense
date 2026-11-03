import { NextResponse } from "next/server";
import { withAuthenticatedApi } from "@/lib/security/api-guards";
import { archiveGroup } from "@/lib/groups/service";

type Context={params:Promise<{groupId:string}>};
export const POST=withAuthenticatedApi<Context>(async(request,{params},user)=>{
  let payload:unknown;
  try { payload=await request.json(); }
  catch {return NextResponse.json({error:"Dữ liệu không hợp lệ."},{status:400});}
  const confirmation=typeof payload==="object"&&payload!==null&&"confirmation" in payload
    ? (payload as {confirmation:unknown}).confirmation:null;
  if(typeof confirmation!=="string"||confirmation.length>120||!confirmation.trim())
    return NextResponse.json({error:"Hãy nhập đúng tên nhóm để xác nhận."},{status:400});
  try {
    await archiveGroup((await params).groupId,user.id,confirmation);
    return NextResponse.json({archived:true});
  }catch(error){
    const message=error instanceof Error?error.message:"Không thể lưu trữ nhóm.";
    return NextResponse.json({error:message},{status:409});
  }
});
