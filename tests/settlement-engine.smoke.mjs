import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {spawn,spawnSync} from 'node:child_process';
import {once} from 'node:events';
import pg from 'pg';
import {buildRuntimeGrantSql} from '../db/rr004-runtime-policy.mjs';
import {FINANCIAL_AUDIT_QUERIES} from '../db/sc007-audit-queries.mjs';
import {seedHistoricalCycleSettings} from './helpers/settlement-history.mjs';
import {fixtureDatabaseUrl} from '../db/rr004-local-runtime.mjs';

const base='postgresql://test:test@localhost:5432/group_expense';
const origin='http://localhost:3103';
test('SC025 real signed HTTP: default OFF, scoped rollout, dual approval, pause/retry and residual CASH without test bypasses',
 {timeout:90000},async()=>{
  assert.equal(process.env.CI,'true');assert.equal(process.env.DATABASE_URL,base);
  const adminUrl=fixtureDatabaseUrl(process.env);
  const admin=new pg.Pool({connectionString:adminUrl,max:1});
  const database='group_expense_sc025http_'+randomUUID().replaceAll('-','');
  const ownerUrl=new URL(adminUrl);ownerUrl.pathname='/'+database;
  const owner=new pg.Pool({connectionString:ownerUrl.toString(),max:2});
  const role='sc025_http_'+randomUUID().replaceAll('-','');
  const groupId=randomUUID(),secret='sc025-http-'+randomUUID();let server,created=false;
  const req=async(method,path,body,actor)=>{
    const headers={origin,'content-type':'application/json',...(actor?.cookie?{cookie:actor.cookie}:{})};
    const response=await fetch(new URL(path,origin),{method,headers,redirect:'manual',
      ...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(15000)});
    const text=await response.text();let json;try{json=JSON.parse(text)}catch{}
    return {status:response.status,body:json,text,cookie:response.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ')};
  };
  const date=days=>new Date(Date.now()+days*86400000).toISOString().slice(0,10);
  try{
    await admin.query('CREATE DATABASE "'+database+'"');
    const migrate=spawnSync(process.execPath,['db/migrate.mjs'],{env:{...process.env,
      DATABASE_URL:ownerUrl.toString(),DATABASE_URL_DIRECT:''},encoding:'utf8',timeout:30000});
    assert.equal(migrate.status,0,migrate.stderr);
    assert.equal((await owner.query('SELECT enabled FROM settlement_cycle_engine_control')).rows[0].enabled,false);
    await owner.query(`CREATE ROLE "${role}" LOGIN PASSWORD 'local-only' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS`);created=true;
    await owner.query(buildRuntimeGrantSql(role).replaceAll('DATABASE group_expense','DATABASE "'+database+'"'));
    const env={...process.env,DATABASE_URL:`postgresql://${role}:local-only@localhost:5432/${database}`,
      DATABASE_URL_DIRECT:'',BETTER_AUTH_URL:origin,BETTER_AUTH_SECRET:'sc025-local-http-only-secret-1234567890123456789',
      OPS_READ_SECRET:secret,CRON_SECRET:'sc025-unused-local-cron-secret'};
    for(const key of ['SC005_TEST_ONLY','BN004_TEST_ONLY','BN006_TEST_ONLY','SC009_TEST_ONLY','RR004_FIXTURE_DATABASE_URL'])delete env[key];
    server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-p','3103'],{env,stdio:'ignore'});
    let ready=false;
    for(let i=0;i<100;i++){
      if(server.exitCode!==null)throw Error('SC025 app server exited: '+server.exitCode);
      try{if((await req('GET','/api/auth/ok')).status===200){ready=true;break}}catch{}
      await new Promise(r=>setTimeout(r,100));
    }
    assert.equal(ready,true);
    const runtime=await fetch(origin+'/api/internal/settlement-ops/runtime',{headers:{authorization:'Bearer '+secret}});
    assert.equal(runtime.status,200);const attestation=await runtime.json();
    assert.equal(attestation.roleFingerprint,createHash('sha256').update(role).digest('hex'));
    assert.equal(attestation.financialEngineReady,false);
    const actors=[];
    for(let i=0;i<3;i++){
      const signup=await req('POST','/api/auth/sign-up/email',{
        name:'SC025 synthetic '+i,email:'sc025-'+randomUUID()+'@example.test',password:'local-only-password-12345'});
      assert.equal(signup.status,200,signup.text);actors.push({id:signup.body.user.id,cookie:signup.cookie});
    }
    const [a,b,third]=actors;
    await owner.query('INSERT INTO groups(id,owner_id,name) VALUES($1,$2,$3)',[groupId,a.id,'SC025 signed financial rollout']);
    for(const [actor,index]of actors.map((a,i)=>[a,i]))await owner.query(
      'INSERT INTO group_members(group_id,user_id,role) VALUES($1,$2,$3)',[groupId,actor.id,index===0?'owner':index===2?'admin':'member']);
    const root='/api/groups/'+groupId,settings=root+'/settlement-cycle/settings',cycles=root+'/settlement-cycle/cycles';
    await seedHistoricalCycleSettings(owner,groupId,a.id,date(-7)+'T00:00:00Z');
    const configured=await req('PATCH',settings,{expectedVersion:1,requestedEnabled:true,requestedBilateralNetting:true},a);
    assert.equal(configured.status,200,configured.text);assert.equal(configured.body.effectiveEnabled,false);
    await owner.query('INSERT INTO group_settlement_schedule_heads(group_id,updated_by) VALUES($1,$2)',[groupId,a.id]);
    await owner.query(`INSERT INTO group_settlement_schedule_revisions
      (id,group_id,version,frequency,time_zone,anchor_date,effective_at,created_by)
      VALUES($1,$2,1,'manual','UTC',$3,$4,$5)`,[randomUUID(),groupId,date(-6),date(-6)+'T00:00:00Z',a.id]);
    const made=await req('POST',cycles,{expectedScheduleVersion:1,requestKey:randomUUID(),startDate:date(-3),endDate:date(-1)},a);
    assert.equal(made.status,201,made.text);const cycleId=made.body.cycle.id;
    assert.equal((await req('POST',cycles+'/'+cycleId+'/review',{expectedVersion:1},a)).status,200);
    for(const [payer,participant,amount]of [[a,b,'130000'],[b,a,'100000'],[a,third,'7000']]){
      const bill=await req('POST',root+'/expenses',{title:'SC025 original bill',occurredOn:date(-2),payerId:payer.id,
        items:[{name:'Original source',quantity:1,unitPriceMinor:amount,participants:[participant.id]}]},payer);
      assert.equal(bill.status,201,bill.text);
    }
    const source=(await owner.query('SELECT to_jsonb(o)::text AS row FROM obligations o WHERE group_id=$1 ORDER BY id',[groupId])).rows;
    const snapshotUrl=cycles+'/'+cycleId+'/snapshot';
    const snap=await req('GET',snapshotUrl,undefined,a);assert.equal(snap.status,200,snap.text);
    const locked=await req('POST',snapshotUrl,{expectedVersion:2,expectedFingerprint:snap.body.snapshot.fingerprint,requestKey:randomUUID()},a);
    assert.equal(locked.status,200,locked.text);
    const proposals=cycles+'/'+cycleId+'/bilateral-proposals';
    const preview=await req('GET',proposals+'?partyAId='+encodeURIComponent(a.id)+'&partyBId='+encodeURIComponent(b.id),undefined,a);
    assert.equal(preview.status,200,preview.text);
    const proposed=await req('POST',proposals,{partyAId:a.id,partyBId:b.id,expectedVersion:0,
      expectedFingerprint:preview.body.fingerprint,requestKey:randomUUID()},a);
    assert.equal(proposed.status,201,proposed.text);let proposal=proposed.body.proposal;
    let decisionUrl=proposals+'/'+proposal.id+'/decisions',applyUrl=proposals+'/'+proposal.id+'/applications';
    const decision=()=>({action:'approve',expectedVersion:proposal.version,expectedFingerprint:proposal.sourceFingerprint,requestKey:randomUUID()});
    let apply={expectedVersion:proposal.version,expectedFingerprint:proposal.sourceFingerprint,requestKey:randomUUID()};
    assert.equal((await req('POST',applyUrl,apply,a)).status,409,'default OFF blocks real writes');
    await owner.query('INSERT INTO settlement_cycle_engine_cohort(group_id) VALUES($1)',[groupId]);
    assert.equal((await req('POST',applyUrl,apply,a)).status,409,'admission without global enable is insufficient');
    await owner.query('UPDATE settlement_cycle_engine_control SET enabled=true');
    assert.equal((await req('GET',settings,undefined,a)).body.effectiveEnabled,true);
    const outside=randomUUID();
    await owner.query('INSERT INTO groups(id,owner_id,name) VALUES($1,$2,$3)',[outside,a.id,'SC025 outside cohort']);
    await owner.query("INSERT INTO group_members(group_id,user_id,role) VALUES($1,$2,'owner')",[outside,a.id]);
    const outsideSetting=await req('PATCH','/api/groups/'+outside+'/settlement-cycle/settings',{
      expectedVersion:0,requestedEnabled:true,requestedBilateralNetting:true},a);
    assert.equal(outsideSetting.status,200,outsideSetting.text);
    assert.equal(outsideSetting.body.effectiveEnabled,false,'global enable never enrolls another opted-in group');
    assert.equal((await req('PATCH',settings,{expectedVersion:2,requestedEnabled:false,requestedBilateralNetting:false},a)).body.effectiveEnabled,false);
    assert.equal((await req('POST',applyUrl,apply,a)).status,409,'group opt-out independently blocks writes');
    assert.equal((await req('PATCH',settings,{expectedVersion:3,requestedEnabled:true,requestedBilateralNetting:true},a)).body.effectiveEnabled,true);
    assert.equal((await req('POST',decisionUrl,decision(),a)).status,409,
      'group opt-out permanently invalidates the prior proposal version');
    const refreshed=await req('GET',proposals+'?partyAId='+encodeURIComponent(a.id)+'&partyBId='+encodeURIComponent(b.id),undefined,a);
    const renewed=await req('POST',proposals,{partyAId:a.id,partyBId:b.id,expectedVersion:proposal.version,
      expectedFingerprint:refreshed.body.fingerprint,requestKey:randomUUID()},a);
    assert.equal(renewed.status,201,renewed.text);proposal=renewed.body.proposal;
    assert.equal(renewed.body.approvalEnabled,true);
    decisionUrl=proposals+'/'+proposal.id+'/decisions';applyUrl=proposals+'/'+proposal.id+'/applications';
    apply={expectedVersion:proposal.version,expectedFingerprint:proposal.sourceFingerprint,requestKey:randomUUID()};
    const page=await req('GET','/groups/'+groupId+'/cycles/'+cycleId,undefined,a);
    assert.equal(page.status,200);assert.ok(page.text.includes('Quyết toán đã mở cho nhóm'));
    assert.equal((await req('POST',applyUrl,apply,third)).status,403,'admin cannot impersonate either party');
    assert.equal((await req('POST',decisionUrl,decision(),a)).status,201);
    assert.equal((await req('POST',applyUrl,apply,a)).status,409,'one approval never applies');
    assert.equal((await req('POST',decisionUrl,decision(),b)).status,201);
    const approved=await req('GET',decisionUrl,undefined,a);
    assert.equal(approved.body.readyForApplication,true);assert.equal(approved.body.financialEngineEnabled,true);
    await owner.query('UPDATE settlement_cycle_engine_control SET enabled=false');
    assert.equal((await req('POST',applyUrl,apply,a)).status,409,'pause blocks an otherwise fully approved application');
    await owner.query('UPDATE settlement_cycle_engine_control SET enabled=true');
    const applied=await Promise.all([req('POST',applyUrl,apply,a),req('POST',applyUrl,apply,a)]);
    assert.deepEqual(applied.map(r=>r.status).sort(),[200,201]);
    const application=applied[0].body.application;assert.equal(applied[0].body.financialEngineEnabled,true);
    assert.equal((await owner.query('SELECT count(*)::int AS n FROM group_settlement_bilateral_applications WHERE group_id=$1',[groupId])).rows[0].n,1);
    await owner.query('UPDATE settlement_cycle_engine_control SET enabled=false');
    const replay=await req('POST',applyUrl,apply,a);assert.equal(replay.status,200);
    assert.equal(replay.body.application.id,application.id);assert.equal(replay.body.financialEngineEnabled,false);
    const residual=cycles+'/'+cycleId+'/bilateral-applications/'+application.id+'/residual';
    assert.equal((await req('GET',residual,undefined,a)).body.writable,false);
    await owner.query('UPDATE settlement_cycle_engine_control SET enabled=true');
    const cashPreview=await req('GET',residual,undefined,a);assert.equal(cashPreview.body.writable,true);
    assert.equal(cashPreview.body.preview.financialEngineEnabled,true);
    assert.equal(cashPreview.body.preview.amountMinor,'30000');
    const cashKey=randomUUID(),cashBody={expectedCycleVersion:3,requestKey:cashKey,expectedFingerprint:cashPreview.body.preview.fingerprint};
    const cash=await req('POST',residual,cashBody,a);assert.equal(cash.status,201,cash.text);
    assert.equal(cash.body.status,'pending');
    await owner.query('UPDATE settlement_cycle_engine_control SET enabled=false');
    const cashRetry=await req('POST',residual,cashBody,a);assert.equal(cashRetry.status,200,cashRetry.text);
    assert.equal(cashRetry.body.id,cash.body.id);
    assert.equal((await req('PATCH',root+'/settlements/'+cash.body.id,{action:'confirm'},a)).status,403);
    assert.equal((await req('PATCH',root+'/settlements/'+cash.body.id,{action:'confirm'},b)).status,200);
    const batchUrl=cycles+'/'+cycleId+'/repayments';
    const batchPreview=await req('GET',batchUrl,undefined,third);
    assert.equal(batchPreview.body.enabled,false);
    const direction=batchPreview.body.pairs.find(p=>p.debtorId===third.id&&p.creditorId===a.id);
    assert.equal(direction.availableMinor,'7000');
    const batchBody={expectedCycleVersion:3,requestKey:randomUUID(),debtorId:third.id,
      creditorId:a.id,expectedFingerprint:direction.fingerprint};
    assert.equal((await req('POST',batchUrl,batchBody,third)).status,409,'pause also blocks ordinary cycle CASH');
    await owner.query('UPDATE settlement_cycle_engine_control SET enabled=true');
    assert.equal((await req('GET',batchUrl,undefined,third)).body.enabled,true);
    const batch=await req('POST',batchUrl,batchBody,third);assert.equal(batch.status,201,batch.text);
    await owner.query('UPDATE settlement_cycle_engine_control SET enabled=false');
    const batchReplay=await req('POST',batchUrl,batchBody,third);
    assert.equal(batchReplay.status,200,batchReplay.text);assert.equal(batchReplay.body.id,batch.body.id);
    assert.equal((await req('PATCH',root+'/settlements/'+batch.body.id,{action:'confirm'},third)).status,403);
    assert.equal((await req('PATCH',root+'/settlements/'+batch.body.id,{action:'confirm'},a)).status,200);
    const balances=(await owner.query('SELECT outstanding_minor::text,pending_cash_minor::text FROM bn005_obligation_balances WHERE group_id=$1',[groupId])).rows;
    assert.ok(balances.every(v=>v.outstanding_minor==='0'&&v.pending_cash_minor==='0'));
    assert.deepEqual((await owner.query('SELECT to_jsonb(o)::text AS row FROM obligations o WHERE group_id=$1 ORDER BY id',[groupId])).rows,source);
    for(const[name,sql]of FINANCIAL_AUDIT_QUERIES)assert.equal((await owner.query(sql)).rows.length,0,name);
    await owner.query('UPDATE settlement_cycle_engine_cohort SET admitted=false WHERE group_id=$1',[groupId]);
    await owner.query('UPDATE settlement_cycle_engine_control SET enabled=false');
  }finally{
    if(server){server.kill('SIGTERM');await Promise.race([once(server,'exit'),new Promise(r=>setTimeout(r,3000))]);}
    if(created)await owner.query('DROP OWNED BY "'+role+'"');
    await owner.end();
    await admin.query('DROP DATABASE IF EXISTS "'+database+'"');
    if(created)await admin.query('DROP ROLE "'+role+'"');
    await admin.end();
  }
});
