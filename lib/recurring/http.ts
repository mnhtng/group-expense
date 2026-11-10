import { NextResponse } from "next/server";
import { ExpenseValidationError } from "@/lib/expenses/domain";
import { RecurringError } from "@/lib/recurring/service";

export const noStore={"Cache-Control":"private, no-store"};
export function recurringFailure(error:unknown) {
  if(error instanceof ExpenseValidationError)
    return NextResponse.json({error:error.message},{status:400,headers:noStore});
  if(error instanceof RecurringError)
    return NextResponse.json({error:error.message},{status:error.status,headers:noStore});
  console.error("Monthly expense request failed",error instanceof Error?error.name:"Unknown");
  return NextResponse.json({error:"Không xử lý được chi phí định kỳ."},{status:500,headers:noStore});
}
export async function readRecurringJson(request:Request) {
  const source=await request.text();
  if(source.length>100_000)
    throw new ExpenseValidationError("Dữ liệu chi phí định kỳ quá lớn.");
  try{return JSON.parse(source) as unknown;}
  catch {throw new ExpenseValidationError("Dữ liệu JSON không hợp lệ.");}
}
