/**
 * RR-003: read-only, explicitly configured operational status probe.
 * The probe is NOT a scheduler or external alert-delivery certification.
 * It never modifies DB, manually replays Cron or logs CRON_SECRET.
 */
import {pathToFileURL} from "node:url";
import {resolve} from "node:path";

const route="/api/internal/settlement-ops/status";
const refuse=message=>{throw Error("RR-003 monitor refused: "+message);};

export function validateMonitorTarget({statusUrl,approvedHost,secret}){
  if(typeof approvedHost!=="string"||
    !/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(approvedHost))
    refuse("explicit DNS hostname approval missing");
  let url;
  try{url=new URL(statusUrl);}catch{refuse("invalid status URL");}
  if(url.protocol!=="https:"||url.hostname!==approvedHost||
    url.pathname!==route||url.search||url.hash||url.username||url.password||
    (url.port&&url.port!=="443"))
    refuse("HTTPS status URL does not match approved endpoint exactly");
  if(typeof secret!=="string"||secret.length<12||/\s/.test(secret))
    refuse("CRON_SECRET missing or invalid");
  return {url:url.href,secret};
}
export function classifyOpsProbeResponse(httpStatus,body){
  const codes=Array.isArray(body?.alertCodes)&&body.alertCodes.length<=30?
    body.alertCodes.filter(s=>typeof s==="string"&&/^[A-Z][A-Z0-9_]{0,79}$/.test(s)):[];
  if(httpStatus===401||httpStatus===403)
    return {ok:false,signal:"AUTH_DENIED",httpStatus,alertCodes:[]};
  if(httpStatus===503)
    return {ok:false,signal:"OPS_ATTENTION",httpStatus,alertCodes:codes};
  if(httpStatus!==200)
    return {ok:false,signal:"UNEXPECTED_HTTP_STATUS",httpStatus,alertCodes:[]};
  if(!Array.isArray(body?.alertCodes)||
    body.alertCodes.length!==codes.length||
    body?.health!=="ok"||codes.length>0||
    body?.financialEngineReady!==false||
    body?.releaseDecision!=="NO-GO")
    return {ok:false,signal:"HEALTH_BODY_MISMATCH",httpStatus,alertCodes:codes};
  return {ok:true,signal:"OPS_HEALTHY",httpStatus,alertCodes:[]};
}
export async function pollOpsMonitor(config,{fetchImpl=fetch}={}){
  const {url,secret}=validateMonitorTarget(config);
  let response;
  try{
    response=await fetchImpl(url,{
      method:"GET",
      headers:{Authorization:"Bearer "+secret,Accept:"application/json"},
      redirect:"error",cache:"no-store",
      signal:AbortSignal.timeout(8000),
    });
  }catch{
    return {ok:false,signal:"NETWORK_OR_TLS_FAILURE",httpStatus:null,alertCodes:[]};
  }
  let body=null;
  try{body=await response.json();}catch{
    return {ok:false,signal:"INVALID_JSON_RESPONSE",
      httpStatus:response.status,alertCodes:[]};
  }
  return classifyOpsProbeResponse(response.status,body);
}
const invoked=process.argv[1]&&
  pathToFileURL(resolve(process.argv[1])).href===import.meta.url;
if(invoked){
  if(process.env.RR003_MONITOR_RUN!=="approved-read-only"){
    console.error("RR-003 monitor refused: opt-in flag missing");
    process.exitCode=2;
  }else{
    try{
      const result=await pollOpsMonitor({
        statusUrl:process.env.RR003_STATUS_URL,
        approvedHost:process.env.RR003_APPROVED_HOST,
        secret:process.env.CRON_SECRET,
      });
      // Only bounded operational signal codes; never echo URLs or bearer.
      console.log(JSON.stringify(result));
      if(!result.ok)process.exitCode=1;
    }catch{
      console.error("RR-003 monitor refused: invalid environment configuration");
      process.exitCode=2;
    }
  }
}
