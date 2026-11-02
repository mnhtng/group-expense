import { NextResponse } from "next/server";
import { ExpenseAccessError } from "@/lib/expenses/service";
import { ExpenseValidationError } from "@/lib/expenses/domain";

export const noStoreHeaders = { "Cache-Control": "private, no-store" };

export function expenseErrorResponse(error: unknown) {
  if (error instanceof ExpenseValidationError) {
    return NextResponse.json({ error: error.message }, { status: 400, headers: noStoreHeaders });
  }
  if (error instanceof ExpenseAccessError) {
    return NextResponse.json({ error: error.message }, { status: error.status, headers: noStoreHeaders });
  }
  // Invalid foreign-key targets and UUIDs must never leak stack traces.
  if (error && typeof error === "object" && "code" in error &&
      (error.code === "22P02" || error.code === "23503")) {
    return NextResponse.json({ error: "Thông tin nhóm hoặc thành viên không hợp lệ." },
      { status: 400, headers: noStoreHeaders });
  }
  console.error("Expense request failed", error instanceof Error ? error.name : "Unknown");
  return NextResponse.json({ error: "Không thể xử lý hóa đơn. Vui lòng thử lại." },
    { status: 500, headers: noStoreHeaders });
}

export async function readJson(request: Request): Promise<unknown> {
  const len = request.headers.get("content-length");
  if (len && Number(len) > 100_000) throw new ExpenseValidationError("Dữ liệu hóa đơn quá lớn.");
  const text = await request.text();
  if (text.length > 100_000) throw new ExpenseValidationError("Dữ liệu hóa đơn quá lớn.");
  try { return JSON.parse(text); } catch { throw new ExpenseValidationError("JSON không hợp lệ."); }
}
