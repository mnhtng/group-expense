import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync,statSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {initialAlertState,advanceAlertState,acknowledgeAlert,deliverOpsAlert,
  flushOpsAlerts,withAlertStateFile,validateAlertDestination} from '../scripts/rr003-alert-runner.mjs';
const bad={ok:false,signal:'OPS_ATTENTION',httpStatus:503,alertCodes:['STUCK_CRON_RUN','PRIVATE_TOKEN']};
const healthy={ok:true,signal:'OPS_HEALTHY',httpStatus:200,alertCodes:[]};
const date=minutes=>new Date(Date.UTC(2026,10,9,14,minutes));
const config={webhookUrl:'https://alerts.example.test/ops',approvedHost:'alerts.example.test',
  secret:'synthetic-recipient-secret-not-the-cron-secret'};
test('RR003 incidents open once, escalate after 15m without acknowledgement and recover once',()=>{
  let state=advanceAlertState(initialAlertState(),healthy,date(0));
  assert.equal(state.pending.length,0);
  state=advanceAlertState(state,bad,date(1));
  assert.equal(state.pending[0].kind,'OPENED');
  assert.deepEqual(state.pending[0].probe.alertCodes,['STUCK_CRON_RUN']);
  const id=state.incident.id;
  state=advanceAlertState(state,bad,date(15));assert.equal(state.pending.length,1);
  state=advanceAlertState(state,bad,date(16));assert.equal(state.pending[1].kind,'ESCALATED');
  state=advanceAlertState(state,bad,date(17));assert.equal(state.pending.length,2);
  state=advanceAlertState(state,healthy,date(18));assert.equal(state.pending[2].kind,'RECOVERED');
  state=advanceAlertState(state,healthy,date(19));assert.equal(state.pending.length,3);
  state=advanceAlertState(state,bad,date(20));assert.notEqual(state.incident.id,id);
  assert.equal(state.pending[3].kind,'OPENED');
});
test('RR003 acknowledgement requires the current incident, suppresses escalation and does not close it',()=>{
  const opened=advanceAlertState(initialAlertState(),bad,date(0));
  assert.throws(()=>acknowledgeAlert(opened,'wrong','operator-1',date(1)));
  let state=acknowledgeAlert(opened,opened.incident.id,'operator-1',date(1));
  assert.equal(state.incident.closedAt,null);
  assert.match(state.incident.acknowledgedBy,/^[a-f0-9]{64}$/);
  state=advanceAlertState(state,bad,date(20));assert.equal(state.pending.length,1);
  state=advanceAlertState(state,healthy,date(21));assert.equal(state.pending[1].kind,'RECOVERED');
  assert.throws(()=>acknowledgeAlert(state,state.incident.id,'operator-1',date(22)));
});
test('RR003 failed deliveries persist and retry the same idempotency key before recovery',async()=>{
  const opened=advanceAlertState(initialAlertState(),bad,date(0));
  const recovered=advanceAlertState(opened,healthy,date(1));
  const calls=[],stored=[];
  let reject=true;
  const send=async(url,options)=>{
    calls.push({url,options});return new Response(null,{status:reject?503:204});
  };
  const first=await flushOpsAlerts(recovered,config,{fetchImpl:send,persist:s=>stored.push(s)});
  assert.equal(first.pending,2);assert.equal(stored.length,0);
  reject=false;
  const next=await flushOpsAlerts(first.state,config,{fetchImpl:send,persist:s=>stored.push(s)});
  assert.equal(next.pending,0);assert.equal(next.delivered,2);
  assert.equal(calls[0].options.headers['Idempotency-Key'],calls[1].options.headers['Idempotency-Key']);
  assert.notEqual(calls[1].options.headers['Idempotency-Key'],calls[2].options.headers['Idempotency-Key']);
  assert.equal(calls[0].options.redirect,'error');
  assert.equal(calls[0].options.headers.Authorization,'Bearer '+config.secret);
  assert.ok(!calls[0].options.body.includes('PRIVATE_TOKEN'));
  assert.ok(!JSON.stringify(next).includes(config.secret));
});
test('RR003 delivery refuses unsafe destinations, unknown payload fields and handles transport/timeout',async()=>{
  for(const patch of [{webhookUrl:'http://alerts.example.test/ops'},
    {approvedHost:'other.test'},{webhookUrl:config.webhookUrl+'?secret=x'},
    {webhookUrl:'https://user:pass@alerts.example.test/ops'},{secret:'short'}])
    assert.throws(()=>validateAlertDestination({...config,...patch}));
  const event=advanceAlertState(initialAlertState(),bad,date(0)).pending[0];
  await assert.rejects(deliverOpsAlert({...event,private:'must not leave'},config));
  assert.equal((await deliverOpsAlert(event,config,{fetchImpl:async()=>{throw Error('secret');}})).signal,'ALERT_TRANSPORT_FAILURE');
  const result=await deliverOpsAlert(event,config,{timeoutMs:5,
    fetchImpl:async(_url,{signal})=>new Promise((_,reject)=>{
      const alive=setTimeout(()=>reject(Error('test timer fallback')),100);
      signal.addEventListener('abort',()=>{clearTimeout(alive);reject(signal.reason);},{once:true});
    })});
  assert.equal(result.delivered,false);
});
test('RR003 state survives restart, locks overlapping runs and fails closed on corrupt state',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'rr003-state-')),path=join(dir,'state.json');
  try{
    await withAlertStateFile(path,async(state,persist)=>{
      const next=advanceAlertState(state,bad,date(0));persist(next);
      await assert.rejects(withAlertStateFile(path,async()=>{}),e=>e.code==='EEXIST');
    });
    assert.equal(statSync(path).mode&0o777,0o600);
    await withAlertStateFile(path,async(state)=>{assert.equal(state.pending.length,1);});
    assert.equal(JSON.parse(readFileSync(path)).pending[0].kind,'OPENED');
    writeFileSync(path,'{broken');
    await assert.rejects(withAlertStateFile(path,async()=>{}));
  }finally{rmSync(dir,{recursive:true,force:true});}
});
