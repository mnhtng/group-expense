import {NextResponse} from "next/server";
import {getCurrentSession} from "@/lib/auth/session";
import {settlementJson,settlementNoStore} from "@/lib/settlements/http";
import {settlementError} from "@/lib/settlement-cycles/http";
import {SettlementSettingsError} from "@/lib/settlement-cycles/settings";
import {assignLateCycleInvoice,listLateCycleAdjustments}
  from "@/lib/settlement-cycles/adjustments";
type Context={params:Promise<{groupId:string;cycleId:string}>};
const unauthorized=()=>NextResponse.json({error:"Chưa đăng nhập."},
  {status:401,headers:settlementNoStore});

/** Manager review: this is immutable attribution of an ORIGINAL invoice,
 * never a new bill, cloned debt or retroactive edit to the locked cycle.
 */
export async function GET(_request:Request,{params}:Context){
  const session=await getCurrentSession();
  if(!session?.user)return unauthorized();
  try{
    const {groupId,cycleId}=await params;
    const result=await listLateCycleAdjustments(groupId,cycleId,session.user.id);
    return NextResponse.json(result,{headers:settlementNoStore});
  }catch(e){return settlementError(e);}
}
export async function POST(request:Request,{params}:Context){
  const session=await getCurrentSession();
  if(!session?.user)return unauthorized();
  try{
    const body=await settlementJson(request);
    if(!body||Array.isArray(body)||typeof body!=="object")
      throw new SettlementSettingsError(400,"Thông tin điều chỉnh không hợp lệ.");
    const fields=body as Record<string,unknown>;
    const required=["expenseId","targetCycleId","expectedExpenseVersion","requestKey"];
    if(required.some(k=>!Object.hasOwn(fields,k))||
       Object.keys(fields).some(k=>![...required,"note"].includes(k)))
      throw new SettlementSettingsError(400,"Trường điều chỉnh không hợp lệ.");
    const {groupId,cycleId}=await params;
    const value=await assignLateCycleInvoice(groupId,cycleId,
      session.user.id,{
        expenseId:fields.expenseId as string,
        targetCycleId:fields.targetCycleId as string,
        expectedExpenseVersion:fields.expectedExpenseVersion as number,
        requestKey:fields.requestKey as string,
        note:fields.note as string|undefined,
      });
    return NextResponse.json(value,{
      status:value.alreadyAssigned?200:201,headers:settlementNoStore});
  }catch(e){return settlementError(e);}
}
