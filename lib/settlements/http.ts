import { NextResponse } from "next/server";
import { SettlementError } from "@/lib/settlements/service";

const headers = { "Cache-Control": "private, no-store" };
export function settlementErrorResponse(error: unknown) {
  if (error instanceof SettlementError)
    return NextResponse.json({ error: error.message }, { status: error.statusCode, headers });
  if (error instanceof Error && error.name === "SyntaxError")
    return NextResponse.json({ error: "JSON không hợp lệ." }, { status: 400, headers });
  if(error && typeof error==="object" && "code" in error &&
    (error.code==="22P02" || error.code==="23503" || error.code==="23514"))
    return NextResponse.json({ error: "Dữ liệu giao dịch không hợp lệ." }, { status: 400, headers });
  console.error("Settlement request failed:", error instanceof Error ? error.name : "unknown");
  return NextResponse.json({ error: "Không thể xử lý thanh toán." }, { status: 500, headers });
}
export async function settlementJson(req: Request): Promise<unknown> {
  const length = req.headers.get("content-length");
  if(length && Number(length)>30_000)throw new SettlementError(400,"Yêu cầu quá lớn.");
  const value = await req.text();
  if(value.length>30_000)throw new SettlementError(400,"Yêu cầu quá lớn.");
  try{return JSON.parse(value)}catch{throw new SettlementError(400,"JSON không hợp lệ.");}
}
export const settlementNoStore = headers;
