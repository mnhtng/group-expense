import { NextResponse } from "next/server";
import { withAuthenticatedApi } from "@/lib/security/api-guards";
import { createGroup } from "@/lib/groups/service";

export const POST=withAuthenticatedApi(async(request,_context,user)=>{
  let data:unknown;
  try{data=await request.json()}catch{
    return NextResponse.json({error:"Dữ liệu không hợp lệ."},{status:400});
  }
  const name=typeof data==="object"&&data!==null&&"name" in data
    ? (data as {name:unknown}).name:null;
  if(typeof name!=="string"||name.trim().length<2||name.trim().length>120)
    return NextResponse.json({error:"Tên nhóm cần từ 2 đến 120 ký tự."},{status:400});
  try{
    const id=await createGroup(user.id,name);
    return NextResponse.json({id},{status:201});
  }catch(error){
    console.error("Could not create group",error instanceof Error?error.name:"Unknown");
    return NextResponse.json({error:"Không thể tạo nhóm. Vui lòng thử lại."},{status:500});
  }
});
