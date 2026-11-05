import {authorizedOpsRequest} from "@/lib/settlement-cycles/ops-auth";
import {readSettlementOpsHealth} from "@/lib/settlement-cycles/ops-runner";
export const dynamic="force-dynamic";
const noStore={"Cache-Control":"private, no-store",
  "X-Content-Type-Options":"nosniff"};
/** Bearer-only, redacted counts/status, no group/member/invoice identifiers. */
export async function GET(request:Request){
  if(!authorizedOpsRequest(request))
    return Response.json({error:"Unauthorized"},{status:401,headers:noStore});
  try{
    const snapshot=await readSettlementOpsHealth();
    return Response.json(snapshot,{status:snapshot.health==="ok"?200:503,headers:noStore});
  }catch(error){
    console.error("Operational health read failed",
      error instanceof Error?error.name:"Unknown");
    return Response.json({error:"Ops health unavailable"},
      {status:503,headers:noStore});
  }
}
