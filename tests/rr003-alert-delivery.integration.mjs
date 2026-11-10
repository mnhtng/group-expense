import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer,request} from 'node:https';
import {once} from 'node:events';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {initialAlertState,advanceAlertState,acknowledgeAlert,flushOpsAlerts}
  from '../scripts/rr003-alert-runner.mjs';

test('RR003 verified TLS delivery retries, operator acknowledgement, escalation and recovery',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'rr003-tls-'));
  const key=join(dir,'key.pem'),cert=join(dir,'cert.pem');
  execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-sha256',
    '-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost',
    '-keyout',key,'-out',cert],{stdio:'ignore'});
  const ca=readFileSync(cert),received=[],seen=new Set();
  let mode='reject';
  const server=createServer({key:readFileSync(key),cert:ca},async(req,res)=>{
    let body='';for await(const part of req)body+=part;
    const payload=JSON.parse(body);
    received.push({payload,key:req.headers['idempotency-key'],authorization:req.headers.authorization});
    if(mode==='timeout')return;
    if(mode==='reject'){res.writeHead(503).end();return;}
    seen.add(payload.eventId);res.writeHead(204).end();
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const config={webhookUrl:`https://localhost:${server.address().port}/ops`,
    approvedHost:'localhost',secret:'synthetic-only-recipient-bearer'};
  // Real TLS sockets validate the temporary localhost certificate against
  // this test CA. No global TLS bypass or external provider is used.
  const fetchImpl=(url,init)=>new Promise((resolve,reject)=>{
    const req=request(url,{method:init.method,headers:init.headers,ca,
      family:4,signal:init.signal},res=>{
      res.resume();resolve(new Response(null,{status:res.statusCode}));
    });
    req.on('error',reject);req.end(init.body);
  });
  let persisted;
  const persist=s=>{persisted=structuredClone(s);};
  const clock=m=>new Date(Date.UTC(2026,10,9,14,m));
  const failure={ok:false,signal:'OPS_ATTENTION',httpStatus:503,alertCodes:['STUCK_CRON_RUN']};
  const healthy={ok:true,signal:'OPS_HEALTHY',httpStatus:200,alertCodes:[]};
  try{
    let state=advanceAlertState(initialAlertState(),failure,clock(0));
    const first=await flushOpsAlerts(state,config,{fetchImpl,persist});
    assert.equal(first.pending,1);assert.equal(first.signal,'ALERT_HTTP_REJECTED');
    mode='accept';
    const accepted=await flushOpsAlerts(first.state,config,{fetchImpl,persist});
    assert.equal(accepted.pending,0);assert.equal(seen.size,1);
    assert.equal(received[0].key,received[1].key);
    assert.equal(received[1].authorization,'Bearer '+config.secret);
    // Recipient HTTP acceptance alone must not create a human acknowledgement.
    assert.equal(persisted.incident.acknowledgedAt,null);
    state=acknowledgeAlert(persisted,persisted.incident.id,'test-operator',clock(1));
    state=advanceAlertState(state,failure,clock(20));assert.equal(state.pending.length,0);
    state=advanceAlertState(state,healthy,clock(21));
    await flushOpsAlerts(state,config,{fetchImpl,persist});
    assert.equal(received.at(-1).payload.kind,'RECOVERED');
    // A new unacknowledged outage escalates once; timeout retains its outbox.
    state=advanceAlertState(persisted,failure,clock(22));
    state=advanceAlertState(state,failure,clock(37));
    assert.deepEqual(state.pending.map(e=>e.kind),['OPENED','ESCALATED']);
    mode='timeout';
    const timed=await flushOpsAlerts(state,config,{fetchImpl,persist,timeoutMs:50});
    assert.equal(timed.pending,2);assert.equal(timed.signal,'ALERT_TRANSPORT_FAILURE');
    mode='accept';
    const retried=await flushOpsAlerts(timed.state,config,{fetchImpl,persist});
    assert.equal(retried.pending,0);
    assert.equal(received.at(-1).payload.kind,'ESCALATED');
    assert.ok(!JSON.stringify(persisted).includes(config.secret));
    assert.ok(!JSON.stringify(persisted).includes(config.webhookUrl));
  }finally{
    server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
    rmSync(dir,{recursive:true,force:true});
  }
});
