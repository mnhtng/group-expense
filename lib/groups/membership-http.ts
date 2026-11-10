import "server-only";
import { NextResponse } from "next/server";
import { MembershipError } from "@/lib/groups/membership";
export function membershipError(error:unknown) {
  if(error instanceof MembershipError)
    return NextResponse.json({error:error.message},{status:error.statusCode});
  if(error && typeof error==="object" && "code" in error &&
      (error.code==="22P02" || error.code==="23503" || error.code==="23514"))
    return NextResponse.json({error:"Thành viên hoặc nhóm không hợp lệ."},{status:400});
  console.error("Group membership request error",error instanceof Error?error.name:"Unknown");
  return NextResponse.json({error:"Không thể cập nhật thành viên. Vui lòng thử lại."},{status:500});
}
