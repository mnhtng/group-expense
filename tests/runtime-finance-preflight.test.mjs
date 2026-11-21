import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {
  REQUIRED_UPDATE_COLUMNS,FORBIDDEN_UPDATE_COLUMNS,
  CASH_INTENT_RUNTIME_PRIVILEGES_SQL,
  evaluateCashIntentRuntimePrivileges,
  projectCashIntentRuntimePrivileges,
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
  assert.doesNotMatch(cli,/resolveDatabaseUrl\\(\"migration\"\\)/);
});
test("pair screen never states no bilateral debt if all previews failed",()=>{
  const ui=readFileSync("components/groups/settlement-cycle-finance-panel.tsx","utf8");
  assert.match(ui,/failed>0/);
  assert.match(ui,/visible\.length===0&&failed===0/);
  assert.match(ui,/Thử lại/);
});
