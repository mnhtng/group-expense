import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const read=file=>readFileSync(file,"utf8");
const service=()=>read("lib/settlement-cycles/owner-activation.ts");
const migration=()=>read("db/migrations/027_owner_cohort_lock_scope.sql");
const route=()=>read("app/api/groups/[groupId]/settlement-cycle/owner-activation/route.ts");
const page=()=>read("app/(app)/groups/[groupId]/manage/page.tsx");
const ui=()=>read("components/groups/settlement-owner-engine-panel.tsx");

test("owner-only controls render in group settlement management",()=>{
  assert.match(page(),/ownerActivation=section==="cycle"&&role==="owner"/);
  assert.match(page(),/ownerActivation&&<SettlementOwnerEnginePanel/);
  assert.match(ui(),/Chỉ chủ nhóm có thể cho phép/);
});

test("signed API and SQL function both verify owner and active membership",()=>{
  assert.match(route(),/withAuthenticatedApi/);
  assert.match(route(),/settlementBody\(request,\[/);
  assert.match(route(),/expectedControlRevision/);
  assert.match(service(),/sc027_owner_cohort_change/);
  assert.match(migration(),/g\.archived_at IS NULL FOR UPDATE/);
  assert.match(migration(),/v_owner<>p_actor OR NOT EXISTS/);
  assert.match(migration(),/m\.status='active'/);
  assert.match(migration(),/SC027_NOT_OWNER/);
});

test("limited separate role gets EXECUTE only; no policy or financial table writes",()=>{
  assert.match(service(),/SETTLEMENT_OWNER_ACTIVATION_DATABASE_URL/);
  assert.match(service(),/operatorUrl===process\.env\.DATABASE_URL/);
  assert.match(service(),/role\.superuser\|\|role\.createRole\|\|role\.createDb/);
  assert.match(service(),/role\.globalWrite\|\|role\.cohortWrite/);
  assert.match(service(),/role\.groupWrite\|\|role\.userWrite\|\|role\.moneyWrite\|\|!role\.functionExecute/);
  assert.match(migration(),/SECURITY DEFINER/);
  assert.match(migration(),/SET search_path=pg_catalog,public/);
  assert.match(migration(),/REVOKE ALL ON FUNCTION public\.sc027_owner_cohort_change/);
  assert.doesNotMatch(service(),/UPDATE settlement_cycle_engine_control/);
  assert.doesNotMatch(service(),/UPDATE settlement_cycle_engine_cohort/);
  assert.match(read("db/rr004-runtime-policy.mjs"),/'settlement_cycle_engine_control','settlement_cycle_engine_cohort','settlement_cycle_engine_events'/);
});

test("global pause, explicit group opt-in and cohort capacity stay authoritative",()=>{
  assert.match(service(),/operator kill switch remains OFF unless explicitly enabled/);
  assert.match(migration(),/COALESCE\(v_opted,false\) IS FALSE/);
  assert.match(migration(),/SC027_GROUP_NOT_OPTED_IN/);
  assert.match(migration(),/SC027_CONTROL_STALE/);
  assert.match(migration(),/SC027_GROUP_STALE/);
  assert.match(migration(),/Rollout cohort capacity exceeded/);
  assert.match(read("lib/settlement-cycles/engine.ts"),/!row\?\.enabled\?"paused":!row\.admitted\?"not-enrolled"/);
  assert.match(migration(),/FOR UPDATE/);
});

test("owner enrollment and revocation are atomic, auditable and ledger-neutral",()=>{
  assert.match(service(),/await client\.query\("BEGIN"\)/);
  assert.match(service(),/await client\.query\("COMMIT"\)/);
  assert.match(service(),/await client\.query\("ROLLBACK"\)/);
  assert.match(migration(),/group_settlement_config_events/);
  assert.match(migration(),/'owner_financial_activation'/);
  assert.match(migration(),/'before',v_admitted,'after',p_enabled/);
  assert.match(read("db/migrations/025_settlement_engine_rollout.sql"),/operator_role text NOT NULL DEFAULT current_user/);
  assert.match(ui(),/aria-label="Xác nhận thay đổi quyền thanh toán"/);
  assert.match(ui(),/view\.globalEnabled&&view\.admitted&&requestedEnabled/);
  assert.doesNotMatch(migration(),/UPDATE settlements|DELETE FROM settlements|INSERT INTO obligations/);
});

test("global OFF or missing scoped credentials never appear as financial access",()=>{
  assert.match(ui(),/canEnable=view\.operatorConfigured&&requestedEnabled/);
  assert.match(ui(),/canDisable=view\.operatorConfigured&&view\.admitted/);
  assert.match(ui(),/!view\.globalEnabled&&<p/);
  assert.match(ui(),/Máy chủ chưa cấu hình quyền kích hoạt có giới hạn/);
  assert.match(ui(),/!requestedEnabled&&<p/);
});
