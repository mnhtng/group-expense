import "server-only";
import { NextResponse } from "next/server";
import { SettlementSettingsError } from "@/lib/settlement-cycles/settings";

type RecordBody = Record<string, unknown>;
const maxBytes=4096;
export async function settlementBody(
  request: Request, requiredKeys: readonly string[],
): Promise<RecordBody> {
  const type=request.headers.get("content-type") ?? "";
  if (!/^application\/json(?:;|$)/i.test(type)) {
    throw new SettlementSettingsError(400, "Yêu cầu JSON hợp lệ.");
  }
  const raw=await request.text();
  if (Buffer.byteLength(raw,"utf8")>maxBytes) {
    throw new SettlementSettingsError(400, "Dữ liệu cấu hình quá lớn.");
  }
  let body:unknown;
  try {body=JSON.parse(raw);} catch {
    throw new SettlementSettingsError(400, "Dữ liệu JSON không hợp lệ.");
  }
  if(!body||Array.isArray(body)||typeof body!=="object") {
    throw new SettlementSettingsError(400, "Dữ liệu phải là đối tượng JSON.");
  }
  const obj=body as RecordBody;
  if(Object.keys(obj).length!==requiredKeys.length ||
     Object.keys(obj).some(key=>!requiredKeys.includes(key)) ||
     requiredKeys.some(key=>!Object.prototype.hasOwnProperty.call(obj,key))) {
    throw new SettlementSettingsError(400, "Các trường cấu hình không hợp lệ.");
  }
  return obj;
}
export function settlementError(error:unknown) {
  if(error instanceof SettlementSettingsError) {
    return NextResponse.json({error:error.message},{status:error.status});
  }
  console.error("Settlement settings request failed",
    error instanceof Error?error.name:"Unknown");
  return NextResponse.json({error:"Không xử lý được cấu hình quyết toán."},{status:500});
}
