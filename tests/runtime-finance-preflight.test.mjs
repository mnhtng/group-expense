import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {
  REQUIRED_UPDATE_COLUMNS,FORBIDDEN_UPDATE_COLUMNS,
  CASH_INTENT_RUNTIME_PRIVILEGES_SQL,
  evaluateCashIntentRuntimePrivileges,
  projectCashIntentRuntimePrivileges,
  CYCLE_COMPLETION_RUNTIME_PRIVILEGES_SQL,
  evaluateCycleCompletionRuntimePrivileges,
} from "../db/runtime-finance-policy.mjs";

function completeAccess(){
  const row={migrated:true,canSelect:true,canInsert:true,
    canUpdateAll:false,canDelete:false,canTruncate:false};
  for(const key of REQUIRED_UPDATE_COLUMNS)row[key]=true;
  for(const key of FORBIDDEN_UPDATE_COLUMNS)row[key]=false;
  return projectCashIntentRuntimePrivileges(row);
}
test("runtime grants require migration 030 and exact minimal privileges",()=>{
  assert.equal(evaluateCashIntentRuntimePrivileges(completeAccess()).ok,true);
  for(const field of ["migrated","canSelect","canInsert",...REQUIRED_UPDATE_COLUMNS]){
    const v=completeAccess();
    if(REQUIRED_UPDATE_COLUMNS.includes(field))v.allowedUpdates[field]=false;
    else v[field]=false;
    const result=evaluateCashIntentRuntimePrivileges(v);
    assert.equal(result.ok,false,field);
  }
  for(const field of ["canUpdateAll","canDelete","canTruncate"]){
    const v=completeAccess();v[field]=true;
    assert.equal(evaluateCashIntentRuntimePrivileges(v).ok,false,field);
  }
  for(const field of FORBIDDEN_UPDATE_COLUMNS){
    const v=completeAccess();v.allowedUpdates[field]=true;
    assert.equal(evaluateCashIntentRuntimePrivileges(v).ok,false,field);
  }
});
test("preflight checks the actual app login, not the schema owner or migration URL",()=>{
  assert.match(CASH_INTENT_RUNTIME_PRIVILEGES_SQL,/has_table_privilege\(current_user/);
  assert.match(CASH_INTENT_RUNTIME_PRIVILEGES_SQL,/schema_migrations/);
  const cli=readFileSync("db/runtime-finance-check.mjs","utf8");
  assert.match(cli,/resolveDatabaseUrl\("runtime"\)/);
  assert.match(cli,/SELECT id FROM public\.group_settlement_bilateral_cash_intents LIMIT 0/);
  assert.ok(!cli.includes('resolveDatabaseUrl("migration")'));
});
test("pair screen never states no bilateral debt if all previews failed",()=>{
  const ui=readFileSync("components/groups/settlement-cycle-finance-panel.tsx","utf8");
  assert.match(ui,/failed>0/);
  assert.match(ui,/visible\.length===0&&failed===0/);
  assert.match(ui,/Thử lại/);
});

test("financial HTTP errors expose SQLSTATE internally but never raw SQL or user data",()=>{
  const handler=readFileSync("lib/settlements/http.ts","utf8");
  assert.match(handler,/sqlState:dbCode/);
  assert.match(handler,/\^\[0-9A-Z\]\{5\}\$/);
  assert.doesNotMatch(handler,/console\.error\([^;]*\b(error\.message|error\.stack)\b/);
});

test("SC031 append-only completion is granted read/create but never edits or deletion",()=>{
  const approved={migrated:true,canSelect:true,canInsert:true,
    canUpdate:false,canDelete:false,canTruncate:false,canTrigger:false};
  assert.equal(evaluateCycleCompletionRuntimePrivileges(approved).ok,true);
  for(const name of ["canSelect","canInsert","migrated"]){
    assert.equal(evaluateCycleCompletionRuntimePrivileges({...approved,[name]:false}).ok,false,name);
  }
  for(const name of ["canUpdate","canDelete","canTruncate","canTrigger"]){
    assert.equal(evaluateCycleCompletionRuntimePrivileges({...approved,[name]:true}).ok,false,name);
  }
  assert.match(CYCLE_COMPLETION_RUNTIME_PRIVILEGES_SQL,
    /has_table_privilege\(current_user/);
  const cli=readFileSync("db/runtime-finance-check.mjs","utf8");
  assert.match(cli,/CYCLE_COMPLETION_RUNTIME_PRIVILEGES_SQL/);
  assert.match(cli,/SELECT cycle_id FROM public\.group_settlement_cycle_completions LIMIT 0/);
});
