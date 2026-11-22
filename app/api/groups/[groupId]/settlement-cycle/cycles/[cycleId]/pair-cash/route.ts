import {NextResponse} from "next/server";
import {getCurrentSession} from "@/lib/auth/session";
import {settlementErrorResponse,settlementJson,settlementNoStore}
  from "@/lib/settlements/http";
import {SettlementError} from "@/lib/settlements/service";
import {processPairCash} from "@/lib/settlement-cycles/paired-cash";

type Context={params:Promise<{groupId:string;cycleId:string}>};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA=/^[0-9a-f]{64}$/;
export async function POST(request:Request,{params}:Context){
  const session=await getCurrentSession();
  if(!session?.user)return NextResponse.json({error:"Chưa đăng nhập."},{
    status:401,headers:settlementNoStore});
  try{
    const input=await settlementJson(request);
    if(!input||typeof input!=="object"||Array.isArray(input))
      throw new SettlementError(400,"Dữ liệu thanh toán không hợp lệ.");
    const body=input as Record<string,unknown>;
    const fields=["action","otherId","expectedVersion","expectedFingerprint","requestKey"];
    if(Object.keys(body).length!==fields.length||
      Object.keys(body).some(k=>!fields.includes(k))||
      !fields.every(k=>Object.hasOwn(body,k))||
      !["start","confirm","reject","cancel"].includes(String(body.action))||
      typeof body.otherId!=="string"||!body.otherId||
      !Number.isSafeInteger(body.expectedVersion)||
      (body.expectedVersion as number)<0||
      !SHA.test(String(body.expectedFingerprint))||
      !UUID.test(String(body.requestKey)))
      throw new SettlementError(400,"Dữ liệu thanh toán không hợp lệ.");
    const {groupId,cycleId}=await params;
    const result=await processPairCash(groupId,cycleId,session.user.id,{
      action:body.action as "start"|"confirm"|"reject"|"cancel",
      otherId:body.otherId as string,
      expectedVersion:body.expectedVersion as number,
      expectedFingerprint:body.expectedFingerprint as string,
      requestKey:body.requestKey as string,
    });
    return NextResponse.json(result,{headers:settlementNoStore});
  }catch(e){return settlementErrorResponse(e);}
}
