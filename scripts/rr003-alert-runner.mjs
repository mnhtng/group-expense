/** External monitor outbox. No database access or financial writes.
 * CLI delivery requires an approved destination; acknowledgement is manual.
 */
import {randomUUID,createHash} from 'node:crypto';
import {readFileSync,writeFileSync,renameSync,mkdirSync,openSync,closeSync,unlinkSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {pollOpsMonitor,classifyOpsProbeResponse} from './rr003-ops-monitor.mjs';
const format='rr003-alert-state-v1';
const signals=new Set(['OPS_HEALTHY','OPS_ATTENTION','AUTH_DENIED','UNEXPECTED_HTTP_STATUS',
  'HEALTH_BODY_MISMATCH','NETWORK_OR_TLS_FAILURE','RESPONSE_TOO_LARGE','INVALID_JSON_RESPONSE']);
const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const refuse=()=>{throw Error('RR-003 alert runner refused invalid configuration or state');};
const iso=value=>typeof value==='string'&&new Date(value).toISOString()===value;
function safeProbe(probe){
  if(!signals.has(probe?.signal)||typeof probe.ok!=='boolean'||
    probe.ok!==(probe.signal==='OPS_HEALTHY')||
    !(probe.httpStatus===null||Number.isInteger(probe.httpStatus)&&probe.httpStatus>=100&&probe.httpStatus<=599))refuse();
  const alertCodes=classifyOpsProbeResponse(503,{alertCodes:probe.alertCodes}).alertCodes;
  return {ok:probe.ok,signal:probe.signal,httpStatus:probe.httpStatus,alertCodes};
}
export function validateAlertState(state){
  if(state?.format!==format||!Array.isArray(state.pending)||state.pending.length>100)refuse();
  const incident=state.incident;
  if(incident&&(!uuid.test(incident.id)||!iso(incident.openedAt)||
    ![null,undefined].includes(incident.closedAt)&&!iso(incident.closedAt)||
    ![null,undefined].includes(incident.acknowledgedAt)&&!iso(incident.acknowledgedAt)))refuse();
  for(const event of state.pending){
    if(event?.format!=='rr003-ops-alert-v1'||!uuid.test(event.eventId)||!uuid.test(event.incidentId)||
      !['OPENED','ESCALATED','RECOVERED'].includes(event.kind)||!iso(event.observedAt))refuse();
    const expected={format:event.format,eventId:event.eventId,incidentId:event.incidentId,
      kind:event.kind,observedAt:event.observedAt,probe:safeProbe(event.probe)};
    if(JSON.stringify(expected)!==JSON.stringify(event))refuse();
  }
  return state;
}
export function initialAlertState(){return {format,incident:null,pending:[]};}
export function advanceAlertState(previous,probe,now=new Date()){
  const state=structuredClone(validateAlertState(previous));
  const signal=safeProbe(probe),at=now.toISOString();
  const enqueue=kind=>{
    if(state.pending.length>=100)refuse();
    state.pending.push({format:'rr003-ops-alert-v1',eventId:randomUUID(),
      incidentId:state.incident.id,kind,observedAt:at,probe:signal});
  };
  if(state.incident&&now.getTime()<Date.parse(state.incident.openedAt))refuse();
  if(!signal.ok){
    if(!state.incident||state.incident.closedAt){
      state.incident={id:randomUUID(),openedAt:at,acknowledgedAt:null,
        acknowledgedBy:null,escalatedAt:null,closedAt:null};
      enqueue('OPENED');
    }else if(!state.incident.acknowledgedAt&&!state.incident.escalatedAt&&
      now.getTime()-Date.parse(state.incident.openedAt)>=15*60*1000){
      state.incident.escalatedAt=at;enqueue('ESCALATED');
    }
  }else if(state.incident&&!state.incident.closedAt){
    state.incident.closedAt=at;enqueue('RECOVERED');
  }
  state.lastObservedAt=at;state.lastProbe=signal;
  return state;
}
export function acknowledgeAlert(previous,incidentId,operatorId,now=new Date()){
  const state=structuredClone(validateAlertState(previous));
  if(!uuid.test(incidentId)||state.incident?.id!==incidentId||state.incident.closedAt||
    typeof operatorId!=='string'||! /^[a-z0-9][a-z0-9_-]{2,63}$/.test(operatorId)||
    now.getTime()<Date.parse(state.incident.openedAt))refuse();
  if(!state.incident.acknowledgedAt){
    state.incident.acknowledgedAt=now.toISOString();
    state.incident.acknowledgedBy=createHash('sha256').update(operatorId).digest('hex');
  }
  return state;
}
export function validateAlertDestination({webhookUrl,approvedHost,secret}){
  let url;try{url=new URL(webhookUrl);}catch{refuse();}
  if(url.protocol!=='https:'||url.hostname!==approvedHost||
    !/^[a-z0-9-]+(?:\.[a-z0-9-]+)*$/i.test(approvedHost)||
    url.username||url.password||url.search||url.hash||
    typeof secret!=='string'||secret.length<12||/\s/.test(secret))refuse();
  return {url:url.href,secret};
}
export async function deliverOpsAlert(event,config,{fetchImpl=fetch,timeoutMs=8000}={}){
  const {url,secret}=validateAlertDestination(config);
  validateAlertState({format,incident:null,pending:[event]});
  if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>8000)refuse();
  try{
    const response=await fetchImpl(url,{method:'POST',redirect:'error',cache:'no-store',
      headers:{Authorization:'Bearer '+secret,'Content-Type':'application/json',
        'Idempotency-Key':event.eventId},body:JSON.stringify(event),
      signal:AbortSignal.timeout(timeoutMs)});
    await response.body?.cancel();
    return {delivered:response.status>=200&&response.status<300,
      signal:response.status>=200&&response.status<300?'ALERT_ACCEPTED':'ALERT_HTTP_REJECTED'};
  }catch{return {delivered:false,signal:'ALERT_TRANSPORT_FAILURE'};}
}
export async function flushOpsAlerts(state,config,{persist,fetchImpl=fetch,timeoutMs=8000}={}){
  validateAlertState(state);
  if(typeof persist!=='function')refuse();
  let current=structuredClone(state),delivered=0;
  while(current.pending.length){
    const result=await deliverOpsAlert(current.pending[0],config,{fetchImpl,timeoutMs});
    if(!result.delivered)return {state:current,delivered,pending:current.pending.length,signal:result.signal};
    current={...current,pending:current.pending.slice(1)};
    await persist(current);delivered++;
  }
  return {state:current,delivered,pending:0,signal:'OUTBOX_EMPTY'};
}
export async function withAlertStateFile(filename,work){
  const path=resolve(filename),lock=path+'.lock';
  mkdirSync(dirname(path),{recursive:true,mode:0o700});
  const fd=openSync(lock,'wx',0o600);
  try{
    let state;
    try{state=validateAlertState(JSON.parse(readFileSync(path,'utf8')));}
    catch(error){if(error.code!=='ENOENT')throw error;state=initialAlertState();}
    const persist=next=>{
      validateAlertState(next);
      const temporary=path+'.'+randomUUID()+'.tmp';
      try{writeFileSync(temporary,JSON.stringify(next)+'\n',{mode:0o600,flag:'wx'});renameSync(temporary,path);}
      finally{try{unlinkSync(temporary);}catch(error){if(error.code!=='ENOENT')throw error;}}
    };
    return await work(state,persist);
  }finally{closeSync(fd);unlinkSync(lock);}
}
const invoked=process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url;
if(invoked){
  try{
    const mode=process.argv[2];
    if(!process.env.RR003_ALERT_STATE_FILE)refuse();
    if(mode==='poll'){
      if(process.env.RR003_ALERT_RUN!=='approved-delivery')refuse();
      const destination={webhookUrl:process.env.RR003_ALERT_URL,
        approvedHost:process.env.RR003_APPROVED_ALERT_HOST,secret:process.env.RR003_ALERT_SECRET};
      validateAlertDestination(destination);
      await withAlertStateFile(process.env.RR003_ALERT_STATE_FILE,async(state,persist)=>{
        const probe=await pollOpsMonitor({statusUrl:process.env.RR003_STATUS_URL,
          approvedHost:process.env.RR003_APPROVED_HOST,
          secret:process.env.OPS_READ_SECRET??process.env.CRON_SECRET});
        const next=advanceAlertState(state,probe);persist(next);
        const result=await flushOpsAlerts(next,destination,{persist});
        console.log(JSON.stringify({probe,incidentId:next.incident?.id??null,
          delivered:result.delivered,pending:result.pending,signal:result.signal}));
        if(!probe.ok||result.pending)process.exitCode=1;
      });
    }else if(mode==='ack'){
      await withAlertStateFile(process.env.RR003_ALERT_STATE_FILE,async(state,persist)=>{
        const next=acknowledgeAlert(state,process.argv[3],process.env.RR003_OPERATOR_ID);
        persist(next);console.log(JSON.stringify({incidentId:next.incident.id,acknowledged:true}));
      });
    }else refuse();
  }catch{
    console.error('RR-003 alert runner failed; inspect approved configuration, state and lock privately');
    process.exitCode=2;
  }
}
