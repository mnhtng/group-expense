import {test} from 'node:test';
import assert from 'node:assert/strict';
import {RUNTIME_TABLES,expectedRuntimePrivileges,evaluateRuntimePrivileges,
  buildRuntimeGrantSql} from '../db/rr004-runtime-policy.mjs';
const valid=()=>({role:{login:true,superuser:false,createRole:false,createDb:false,
  replication:false,bypassRls:false,memberships:0,ownsDatabase:false,ownsObjects:false,
  schemaCreate:false,databaseCreate:false,temporary:false,securityDefiners:false,
  defaultObjectPrivileges:false,lockGuardsPresent:true},
  tables:RUNTIME_TABLES.map(table=>{const p=expectedRuntimePrivileges(table);return {
    table,select:p.select,insert:p.insert,update:p.update,delete:p.delete,
    updateColumns:p.columns,insertColumns:[],referenceColumns:[],
    truncate:false,trigger:false,references:false};})});
test('RR-004 dedicated runtime profile cannot certify a release or live deployment',()=>{
  const r=evaluateRuntimePrivileges(valid());assert.equal(r.ok,true);
  assert.equal(r.liveRoleCertified,false);assert.equal(r.releaseDecision,'NO-GO');
});
test('RR-004 rejects owner/admin, memberships, DDL/temp, unsafe functions and missing guards',()=>{
  for(const key of ['superuser','createRole','createDb','replication','bypassRls','ownsDatabase',
    'ownsObjects','schemaCreate','databaseCreate','temporary','securityDefiners','defaultObjectPrivileges']){
    for(const value of [true,undefined,null]){
      const s=valid();s.role[key]=value;assert.equal(evaluateRuntimePrivileges(s).ok,false,key);
    }
  }
  for(const memberships of [1,undefined,-1]){
    const s=valid();s.role.memberships=memberships;assert.equal(evaluateRuntimePrivileges(s).ok,false);
  }
  const s=valid();s.role.lockGuardsPresent=false;
  assert.ok(evaluateRuntimePrivileges(s).blockerCodes.includes('IMMUTABLE_LOCK_GUARD_MISSING'));
});
test('RR-004 rejects missing tables, audit editing, immutable column escalation and TRUNCATE',()=>{
  const missing=valid();missing.tables.pop();assert.equal(evaluateRuntimePrivileges(missing).ok,false);
  for(const patch of [{update:true},{delete:true},{truncate:true},{trigger:true},{references:true},
    {updateColumns:['id','reason']},{insertColumns:['reason']},{referenceColumns:['id']}]){
    const s=valid();Object.assign(s.tables.find(t=>t.table==='group_settlement_cycle_disputes'),patch);
    assert.equal(evaluateRuntimePrivileges(s).ok,false);
  }
  assert.equal(evaluateRuntimePrivileges({}).ok,false);
});
test('RR-004 role names cannot inject SQL or change role attributes in a grant plan',()=>{
  for(const role of ['evil; DROP TABLE groups','test"','',null])assert.throws(()=>buildRuntimeGrantSql(role));
  const sql=buildRuntimeGrantSql('rr004_runtime');
  assert.doesNotMatch(sql,/CREATE ROLE|ALTER ROLE|PASSWORD|SECURITY DEFINER/i);
  assert.match(sql,/GRANT UPDATE \("id"\) ON public\."group_settlement_bilateral_proposals"/);
  assert.doesNotMatch(sql,/GRANT (?:[^;]*,)?TRUNCATE/);
});

test('RR-004 fixture override cannot redirect app runtime or use shared credentials',async()=>{
  const {fixtureDatabaseUrl,RR004_LOCAL_RUNTIME,RR004_LOCAL_OWNER}=await import('../db/rr004-local-runtime.mjs');
  const good={CI:'true',RR004_TEST_ONLY:'isolated-pg17',DATABASE_URL:RR004_LOCAL_RUNTIME,
    RR004_FIXTURE_DATABASE_URL:RR004_LOCAL_OWNER};
  assert.equal(fixtureDatabaseUrl(good),RR004_LOCAL_OWNER);
  for(const patch of [{CI:'false'},{RR004_TEST_ONLY:undefined},
    {DATABASE_URL:'postgresql://shared.neon.tech/group_expense'},
    {RR004_FIXTURE_DATABASE_URL:'postgresql://other-owner@localhost:5432/group_expense'}])
    assert.throws(()=>fixtureDatabaseUrl({...good,...patch}),/refuses non-disposable/);
  assert.equal(fixtureDatabaseUrl({DATABASE_URL:RR004_LOCAL_RUNTIME}),RR004_LOCAL_RUNTIME);
});
