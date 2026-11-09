import {authorizedOpsReadRequest} from "@/lib/settlement-cycles/ops-auth";
import {readRuntimeAttestation} from "@/lib/settlement-cycles/runtime-attestation";

const headers={"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"};
export async function GET(request:Request){
  if(!authorizedOpsReadRequest(request))
    return Response.json({error:"Unauthorized"},{status:401,headers});
  try{
    const report=await readRuntimeAttestation();
    return Response.json(report,{status:report.ok?200:503,headers});
  }catch{
    return Response.json({error:"Runtime attestation unavailable"},{status:503,headers});
  }
}
