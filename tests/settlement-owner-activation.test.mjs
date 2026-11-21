import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const read=file=>readFileSync(file,"utf8");
const svc=()=>read("lib/settlement-cycles/owner-activation.ts");
const engine=()=>read("lib/settlement-cycles/engine.ts");
const migration=()=>read("db/migrations/028_group_scoped_financial_engine.sql");
const settings=()=>read("lib/settlement-cycles/settings.ts");
const route=()=>read("app/api/groups/[groupId]/settlement-cycle/owner-activation/route.ts");
const page=()=>read("app/(app)/groups/[groupId]/manage/page.tsx");
const ui=()=>read("components/groups/settlement-owner-engine-panel.tsx");

test("SC028 group-owner only UI and signed API, independent server owner verification",()=>{
  assert.match(page(),/ownerActivation=section==="cycle"&&role==="owner"/);
  assert.match(page(),/ownerActivation&&<SettlementOwnerEnginePanel/);
  assert.match(route(),/withAuthenticatedApi/);
  assert.match(route(),/expectedSettingsVersion/);
  assert.match(route(),/expectedEnabled/);
  assert.match(svc(),/WHERE id=\$1 AND archived_at IS NULL FOR UPDATE/);
  assert.match(svc(),/group\.rows\[0\]\.owner_id!==actorId\|\|!member\.rowCount/);
  assert.match(svc(),/m\.status='active'|status='active'/);
  assert.match(svc(),/throw new SettlementSettingsError\(403/);
});

test("SC028 financial write authorization is per group, NOT legacy global rollout or cohort",()=>{
  assert.match(engine(),/p\.emergency_paused,s\.financial_engine_enabled/);
  assert.match(engine(),/!row\.financial_engine_enabled\?"not-enrolled":"enabled"/);
  assert.doesNotMatch(engine(),/!row\?\.enabled\?"paused"/);
});

test("SC028 migration is additive and all existing groups start with financial writes disabled",()=>{
  assert.match(migration(),/ADD COLUMN financial_engine_enabled boolean NOT NULL DEFAULT false/);
  assert.match(migration(),/ADD COLUMN emergency_paused boolean NOT NULL DEFAULT false/);
  assert.match(migration(),/sc028_financial_engine_requires_settlement/);
  assert.doesNotMatch(migration(),/\bDROP TABLE\b|\bDELETE FROM expenses\b|\bUPDATE obligations\b/i);
  assert.doesNotMatch(migration(),/UPDATE group_settlement_settings SET financial_engine_enabled=true/);
});

test("SC028 owner update version checks, audit, and finance-neutral transaction",()=>{
  assert.match(svc(),/row\.version!==input\.expectedSettingsVersion/);
  assert.match(svc(),/row\.financial_engine_enabled!==input\.expectedEnabled/);
  assert.match(svc(),/await client\.query\("BEGIN"\)/);
  assert.match(svc(),/await client\.query\("COMMIT"\)/);
  assert.match(svc(),/await client\.query\("ROLLBACK"\)/);
  assert.match(svc(),/group_settlement_config_events/);
  assert.match(svc(),/subject:"group_financial_engine"/);
  assert.doesNotMatch(svc(),/SETTLEMENT_OWNER_ACTIVATION_DATABASE_URL|settlement_cycle_engine_cohort/);
  assert.doesNotMatch(svc(),/INSERT INTO settlements|UPDATE obligations|DELETE FROM settlements/);
});

test("SC028 disabling settlement automatically disables finance to prevent unexpected reactivation",()=>{
  assert.match(settings(),/financial_engine_enabled=CASE WHEN \$2 THEN financial_engine_enabled ELSE false END/);
  assert.match(settings(),/financialEngineAutoDisabled/);
  assert.match(migration(),/CHECK \(NOT financial_engine_enabled OR requested_enabled\)/);
  assert.match(svc(),/!row\.requested_enabled/);
});

test("SC028 independent operator-only emergency stop serializes financial writers",()=>{
  assert.match(engine(),/row\.emergency_paused\?"paused"/);
  assert.match(engine(),/pg_advisory_xact_lock_shared\(250025,1\)/);
  assert.match(migration(),/pg_advisory_xact_lock\(250025,1\)/);
  assert.match(migration(),/CREATE OR REPLACE FUNCTION public.sc025_control_guard/);
  assert.match(migration(),/ADD COLUMN emergency_paused boolean NOT NULL DEFAULT false/);
  assert.match(ui(),/view\.emergencyPaused/);
  assert.match(ui(),/Bật Financial Engine cho nhóm/);
  assert.match(ui(),/Tắt Financial Engine của nhóm/);
  assert.match(ui(),/aria-label="Xác nhận thay đổi quyền thanh toán"/);
});
