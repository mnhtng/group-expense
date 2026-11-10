import {assertDefaultEngineDisabled} from './helpers/engine-release-policy.mjs';
import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {classifyOpsProbeResponse,pollOpsMonitor,validateMonitorTarget}
  from "../scripts/rr003-ops-monitor.mjs";
const host="isolated-example.test";
const secret="synthetic-rr003-monitor-token-not-real";
const valid=()=>({
  statusUrl:"https://"+host+"/api/internal/settlement-ops/status",
  approvedHost:host,secret,
});
test("RR-003 monitor refuses unapproved, insecure, redirected or credentialed URLs",()=>{
  validateMonitorTarget(valid());
  const rejected=[
    {statusUrl:"http://"+host+"/api/internal/settlement-ops/status"},
    {approvedHost:"another.example.test"},
    {statusUrl:"https://"+host+"/api/internal/push-drain"},
    {statusUrl:valid().statusUrl+"?token=abc"},
    {statusUrl:valid().statusUrl+"#secret"},
    {statusUrl:"https://user:pass@"+host+"/api/internal/settlement-ops/status"},
    {statusUrl:"https://"+host+":5432/api/internal/settlement-ops/status"},
    {secret:"short"},
  ];
  for(const patch of rejected)
    assert.throws(()=>validateMonitorTarget({...valid(),...patch}),/RR-003 monitor refused/);
});
test("RR-003 separates healthy, 503, authentication and malformed responses",()=>{
  assert.deepEqual(classifyOpsProbeResponse(200,{health:"ok",alertCodes:[],
    financialEngineReady:false,releaseDecision:"NO-GO"}),
    {ok:true,signal:"OPS_HEALTHY",httpStatus:200,alertCodes:[]});
  const attention=classifyOpsProbeResponse(503,{
    health:"attention",alertCodes:["STUCK_CRON_RUN","FAILED_CHECKPOINT","sensitive name"]});
  assert.equal(attention.ok,false);
  assert.deepEqual(attention.alertCodes,["STUCK_CRON_RUN"]);
  assert.equal(classifyOpsProbeResponse(200,{health:"attention"}).ok,false);
  assert.equal(classifyOpsProbeResponse(200,{}).signal,"HEALTH_BODY_MISMATCH");
  assert.equal(classifyOpsProbeResponse(200,{health:"ok",alertCodes:[],
    financialEngineReady:true,releaseDecision:"GO"}).ok,false);
  assert.equal(classifyOpsProbeResponse(200,{health:"ok",alertCodes:[],
    financialEngineReady:false,releaseDecision:"NO-GO"}).ok,true);
  assert.equal(classifyOpsProbeResponse(401,{error:"Unauthorized"}).signal,"AUTH_DENIED");
  assert.equal(classifyOpsProbeResponse(302,{}).signal,"UNEXPECTED_HTTP_STATUS");
});
test("RR-003 probes signed GET only, no replay and no URL/secret in results",async()=>{
  const calls=[];
  const result=await pollOpsMonitor(valid(),{
    fetchImpl:async (url,init)=>{
      calls.push({url,init});
      return Response.json({health:"ok",alertCodes:[],
        financialEngineReady:false,releaseDecision:"NO-GO"});
    },
  });
  assert.equal(result.ok,true);
  assert.equal(calls.length,1);
  assert.equal(calls[0].init.method,"GET");
  assert.equal(calls[0].init.headers.Authorization,"Bearer "+secret);
  assert.equal(calls[0].init.redirect,"error");
  assert.equal(calls[0].init.cache,"no-store");
  assert.ok(!JSON.stringify(result).includes(secret));
  assert.ok(!JSON.stringify(result).includes(host));
});
test('RR-003 recognizes bounded controlled rollout but rejects unqualified engine-ready claims',()=>{
 const body={health:'ok',alertCodes:[],financialEngineReady:true,releaseDecision:'CONTROLLED_ROLLOUT',
   rollout:{enabled:true,cohortLimit:1,admittedGroups:1,revision:2}};
 assert.equal(classifyOpsProbeResponse(200,body).ok,true);
 for(const patch of [{enabled:false},{cohortLimit:2},{admittedGroups:0},{admittedGroups:2},{revision:0}])
   assert.equal(classifyOpsProbeResponse(200,{...body,rollout:{...body.rollout,...patch}}).ok,false);
});
test("RR-003 transport failures and invalid JSON fail closed",async()=>{
  const failed=await pollOpsMonitor(valid(),{
    fetchImpl:async()=>{throw Error("would contain token, never print me");},
  });
  assert.equal(failed.signal,"NETWORK_OR_TLS_FAILURE");
  const invalid=await pollOpsMonitor(valid(),{
    fetchImpl:async()=>new Response("bad"),
  });
  assert.equal(invalid.signal,"INVALID_JSON_RESPONSE");
});
test("RR-003 read-only monitor cannot activate finance or trigger manual replay",()=>{
  const source=readFileSync("scripts/rr003-ops-monitor.mjs","utf8");
  assert.match(source,/method:"GET"/);
  assert.match(source,/redirect:"error"/);
  assert.match(source,/approved-read-only/);
  assert.doesNotMatch(source,/method:"POST"|X-Ops-Replay-Reason/);
  assert.doesNotMatch(source,/\b(?:INSERT|UPDATE|DELETE|DROP|ALTER)\s+(?:INTO|FROM|TABLE)/i);
  assertDefaultEngineDisabled();
});

test("RR-003 redacts uppercase unknown codes and bounds untrusted HTTP bodies",async()=>{
  assert.deepEqual(classifyOpsProbeResponse(503,{alertCodes:[
    "STUCK_CRON_RUN","SENSITIVE_UPPERCASE_TOKEN_123","ALICE_SMITH",
  ]}).alertCodes,["STUCK_CRON_RUN"]);
  assert.equal((await pollOpsMonitor(valid(),{
    fetchImpl:async()=>new Response("x".repeat(65537)),
  })).signal,"RESPONSE_TOO_LARGE");
  assert.equal((await pollOpsMonitor(valid(),{
    fetchImpl:async()=>new Response("<html>Forbidden</html>",{status:403}),
  })).signal,"AUTH_DENIED");
});
