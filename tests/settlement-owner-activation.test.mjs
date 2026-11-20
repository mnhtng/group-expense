import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const read=file=>readFileSync(file,"utf8");
const service=()=>read("lib/settlement-cycles/owner-activation.ts");
const route=()=>read("app/api/groups/[groupId]/settlement-cycle/owner-activation/route.ts");
const page=()=>read("app/(app)/groups/[groupId]/manage/page.tsx");
const ui=()=>read("components/groups/settlement-owner-engine-panel.tsx");

test("owner-only controls render strictly within group management and for group owner",()=>{
  assert.match(page(),/ownerActivation=section==="cycle"&&role==="owner"/);
  assert.match(page(),/ownerActivation&&<SettlementOwnerEnginePanel/);
  assert.match(ui(),/Chỉ chủ nhóm có thể cho phép/);
  assert.doesNotMatch(ui(),/settlement_cycle_engine_control.+UPDATE/);
});

test("signed API revalidates actual active membership and owner on server",()=>{
  assert.match(route(),/withAuthenticatedApi/);
  assert.match(route(),/settlementBody\(request,\[/);
  assert.match(route(),/expectedControlRevision/);
  assert.match(service(),/WHERE id=\$1 AND archived_at IS NULL FOR SHARE/);
  assert.match(service(),/gr\.rows\[0\]\.owner_id!==actorId\|\|!membership\.rowCount/);
  assert.match(service(),/throw new SettlementSettingsError\(403/);
});

test("fails closed without independent scoped credential and rejects owner/global privilege",()=>{
  assert.match(service(),/SETTLEMENT_OWNER_ACTIVATION_DATABASE_URL/);
  assert.match(service(),/operatorUrl===process\.env\.DATABASE_URL/);
  assert.match(service(),/op\.superuser\|\|op\.createRole\|\|op\.createDb/);
  assert.match(service(),/op\.globalWrite\|\|!op\.cohortWrite\|\|op\.moneyWrite/);
  assert.match(service(),/op\.groupWrite\|\|op\.userWrite/);
  assert.doesNotMatch(service(),/UPDATE settlement_cycle_engine_control/);
  assert.doesNotMatch(service(),/GRANT .*settlement_cycle_engine_control/);
  assert.match(read("db/rr004-runtime-policy.mjs"),/'settlement_cycle_engine_control','settlement_cycle_engine_cohort','settlement_cycle_engine_events'/);
});

test("activation preserves operator kill switch, group opt-in, and cohort limit",()=>{
  assert.match(service(),/Joining while globally paused is a pending group admission only/);
  assert.match(read("db/migrations/027_owner_cohort_lock_scope.sql"),/Zero admitted groups implies zero eligible money writes/);
  assert.match(service(),/settings\.rows\[0\]\?\.requested_enabled/);
  assert.match(service(),/cohort_limit AS "cohortLimit"/);
  assert.match(service(),/expectedAdmitted/);
  assert.match(service(),/ctl\.revision!==input\.expectedControlRevision/);
  assert.match(read("lib/settlement-cycles/engine.ts"),/!row\?\.enabled\?"paused":!row\.admitted\?"not-enrolled"/);
  assert.match(read("db/migrations/025_settlement_engine_rollout.sql"),/Rollout cohort capacity exceeded/);
  assert.match(read("db/migrations/027_owner_cohort_lock_scope.sql"),/FOR SHARE/);
});

test("no history rewriting: audit owner attribution and atomically cancel on failure",()=>{
  assert.match(service(),/await client\.query\("BEGIN"\)/);
  assert.match(service(),/await client\.query\("COMMIT"\)/);
  assert.match(service(),/await client\.query\("ROLLBACK"\)/);
  assert.match(service(),/group_settlement_config_events/);
  assert.match(service(),/subject:"owner_financial_activation"/);
  assert.match(read("db/migrations/025_settlement_engine_rollout.sql"),/operator_role text NOT NULL DEFAULT current_user/);
  assert.match(ui(),/aria-label="Xác nhận thay đổi quyền thanh toán"/);
  assert.match(ui(),/router\.refresh\(\)/);
  assert.match(ui(),/view\.globalEnabled&&view\.admitted&&requestedEnabled/);
  assert.doesNotMatch(service(),/UPDATE settlements|DELETE FROM settlements|INSERT INTO obligations/);
});

test("operator globally paused or unavailable never appears enabled in UI",()=>{
  assert.match(ui(),/canEnable=view\.operatorConfigured&&requestedEnabled/);
  assert.match(ui(),/canDisable=view\.operatorConfigured&&view\.admitted/);
  assert.match(ui(),/!view\.globalEnabled&&<p/);
  assert.match(ui(),/Máy chủ chưa cấu hình quyền kích hoạt có giới hạn/);
  assert.match(ui(),/!requestedEnabled&&<p/);
});
