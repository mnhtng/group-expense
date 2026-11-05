import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=p=>readFileSync(p,"utf8");
test("SC-009 immutable pair dispute: no multi-party actor, update/delete or money edits",()=>{
 const migration=read("db/migrations/022_settlement_cycle_notifications_disputes.sql");
 const service=read("lib/settlement-cycles/disputes.ts");
 assert.match(migration,/sc009_dispute_not_self/);
 assert.match(migration,/sc009_dispute_origin_fk/);
 assert.match(migration,/group_settlement_cycle_dispute_events/);
 assert.match(migration,/SC-009 dispute provenance is immutable/);
 assert.match(migration,/SC-009 dispute events are immutable/);
 assert.match(migration,/status IN\('open','awaiting_reporter'\)/);
 assert.match(migration,/sc009_no_disputed_noncash/);
 assert.match(migration,/sc009_no_disputed_cash/);
 assert.match(service,/actorId!==row.debtorId&&actorId!==row.creditorId/);
 assert.match(service,/actorId!==d.reporterId&&actorId!==d.counterpartyId/);
 assert.match(service,/withRead|BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY/);
 assert.match(service,/request_key=\$3/);
 assert.doesNotMatch(service,/UPDATE\s+(?:obligations|expenses|settlements)|INSERT INTO\s+settlements/i);
});
test("SC-009 cycle notifications extend existing inbox, push jobs and remain event-idempotent",()=>{
 const sql=read("db/migrations/022_settlement_cycle_notifications_disputes.sql");
 const list=read("lib/notifications/service.ts");
 assert.match(sql,/ALTER TABLE notifications ALTER COLUMN settlement_id DROP NOT NULL/);
 assert.match(sql,/sc009_notification_event_unique/);
 assert.match(sql,/ON CONFLICT\(recipient_id,event_key\) WHERE event_key IS NOT NULL DO NOTHING/);
 assert.match(sql,/INSERT INTO notification_push_jobs/);
 for(const kind of ["cycle_review","cycle_locked","setoff_proposed",
  "setoff_decision","setoff_applied","late_invoice_attributed",
  "cycle_dispute_opened","cycle_dispute_responded","cycle_dispute_closed",
  "cycle_reminder"]) assert.ok(sql.includes(kind));
 assert.match(list,/LEFT JOIN "user" actor/);
 assert.match(list,/COALESCE\(actor.name,'Hệ thống'\)/);
 assert.match(list,/settlement_confirmed/);
});
test("SC-009 client never accepts spoofed actor or confirmation, export is source-scoped",()=>{
 const paths=[
  "app/api/groups/[groupId]/settlement-cycle/cycles/[cycleId]/disputes/route.ts",
  "app/api/groups/[groupId]/settlement-cycle/cycles/[cycleId]/disputes/[disputeId]/events/route.ts",
  "app/api/groups/[groupId]/settlement-cycle/cycles/[cycleId]/reconciliation/route.ts",
  "app/api/groups/[groupId]/settlement-cycle/cycles/[cycleId]/audit/route.ts",
  "app/api/groups/[groupId]/settlement-cycle/cycles/[cycleId]/export/route.ts",
 ];
 for(const path of paths){
  const src=read(path);
  assert.match(src,/getCurrentSession\(\)/);
  assert.match(src,/session\.user\.id/);
  assert.doesNotMatch(src,/actorId:body|status:body|confirmed:body/);
 }
 const service=read("lib/settlement-cycles/reconciliation.ts");
 assert.match(service,/REPEATABLE READ READ ONLY/);
 assert.match(service,/JOIN bn005_obligation_balances b/);
 assert.match(service,/sourceCount>MAX_EXPORT/);
 assert.match(service,/currentProposals/);
 assert.match(service,/confirmedSetoffMinor/);
 assert.match(service,/SELECT \* FROM \(\$\{auditUnion\}\) events/);
 assert.match(service,/\uFEFF/);
});
test("SC-009 daily reminders are bounded, deduplicated and unconditionally OFF outside gated CI",()=>{
 const reminder=read("lib/settlement-cycles/reminders.ts");
 const cron=read("app/api/internal/push-drain/route.ts");
 const workflow=read(".github/workflows/sprint1-integration.yml");
 assert.match(reminder,/SETTLEMENT_CYCLE_ENGINE_READY/);
 assert.match(reminder,/process.env.CI==="true"/);
 assert.match(reminder,/process.env.SC009_TEST_ONLY==="isolated-pg17"/);
 assert.match(reminder,/postgresql:\/\/test:test@localhost:5432\/group_expense/);
 assert.match(reminder,/LIMIT \$1/);
 assert.match(reminder,/remind:\$\{day\}/);
 assert.match(cron,/issueCycleReminders\(40\)/);
 assert.match(workflow,/SC009_TEST_ONLY: isolated-pg17/);
 assert.match(read("lib/settlement-cycles/settings.ts"),
  /SETTLEMENT_CYCLE_ENGINE_READY = false/);
});
test("SC-009 mobile UI: signed ledger, audit, 2-person dispute actions and offline-safe consent",()=>{
 const page=read("app/(app)/groups/[groupId]/cycles/[cycleId]/page.tsx");
 const comp=read("components/groups/settlement-cycle-ops-panel.tsx");
 assert.match(page,/SettlementCycleOpsPanel/);
 assert.match(comp,/role="alert"/);
 assert.match(comp,/role="status"/);
 assert.match(comp,/min-h-12/);
 assert.match(comp,/!consent/);
 assert.match(comp,/mySources=visibleSources\.filter/);
 assert.match(comp,/readyForManualReview/);
 assert.match(comp,/Bù trừ phi tiền mặt|Đã bù trừ phi tiền mặt/);
 assert.match(comp,/export\?kind=ledger/);
 assert.match(comp,/export\?kind=audit/);
 assert.match(comp,/canResolve/);
 assert.match(comp,/canRespond/);
 assert.match(comp,/canWithdraw/);
 assert.doesNotMatch(comp,/<details|<summary|window\.confirm\(/i);
});
