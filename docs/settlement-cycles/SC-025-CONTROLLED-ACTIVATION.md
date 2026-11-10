# SC-025 — controlled financial activation

Owner requested completion of real cycle settlement after the application-only
release. Work branch: `feat/settlement-cycle-activation`, based on main PR20 so
the existing PWA install banner is preserved. Follow feature→develop→main PRs.

## Implemented policy

Migration025 creates operator control, group cohort and immutable rollout audit.
It seeds **disabled, cohort limit1, no admitted groups** and changes no original
money/audit rows. Capacity is exactly1/5/25, concurrent admission cannot overfill,
and reducing capacity cannot drop admitted groups. Removing the last group
requires pausing first. Group identities/history cannot be deleted or truncated.
Every operator update records the actual database role and old/new state.

Runtime has SELECT only on the three policy tables. No owner/delegate/web
endpoint can change operator control. New financial writes require global enable,
exact admitted group and explicit group opt-in; bilateral writes additionally
require bilateral opt-in. Existing session, true pair identities, two approvals,
fingerprint, dispute, idempotency and SQL conservation checks remain intact.

Writers lock group then shared transaction advisory key(250025,1). Operator
updates take its exclusive counterpart. Pause waits for an already-authorized
write to finish; subsequent writes see paused state. No policy UPDATE grant is
needed for runtime. Group opt-out still invalidates old proposal versions;
reenabling never revives those signatures. A fresh proposal is required.

Same-key retries after pause read committed documents without another ledger
write. Existing pending manual CASH retains the original other-party confirmation
flow. Policy is read without cross-request cache. UI/API/operational responses now
report actual scoped state rather than a hardcoded false. Health responses expose
only rollout counts/capacity/revision, never the cohort group list.

Runtime profile is56 objects/29 guards; recovery inventory includes the three new
policy tables. Legacy test-only shortcuts remain CI + exact disposable localhost
URL + individual flags. The new signed HTTP test uses a separate limited role
and database and removes all monetary test flags, exercising the real gate.

## Local verification

Verified code digest (277 source/config/test files):
`c440984adbc97b16f6837d292aca060edff5848943ffc3da5e3ef3f00ef360ae`.
Documentation is excluded from this digest. Private logs live under
`rr003-artifacts/2026-11-10-activation/` and are not published.

- Unit182/182 PASS; lint exits0, one pre-existing unused-import warning.
- Limited non-owner role production build/TypeScript PASS,56 objects/29 guards
  pass before and after signed HTTP and browser verification.
- Two signed HTTP suites PASS, including a separate private DB/limited role with
  all monetary test flags removed: default OFF, opted-in unenrolled groups,
  opt-out invalidation, independent dual approval, concurrent same-key NONCASH,
  pause/new-write denial and replay, residual and ordinary cycle CASH, true
  counterparty confirmation, unchanged original obligations and eight zero audits.
- Four browser profiles PASS: Chromium/WebKit desktop and emulated iPhone13/
  Pixel7. They retain the old OFF/privacy/offline/keyboard checks, then admit only
  their new disposable synthetic group and click the real proposal→approval→
  revocation→fresh version→two approvals→NONCASH→residual pending CASH→other-party
  confirmation flow without finance write flags. These are not physical devices.
- Final owner profile PASS: migrate twice/checksums,13/13 PG17 integration,
  production build/TypeScript,2/2 signed HTTP suites, eight zero-violation audits
  and logical restore with61/61 full-row/schema comparisons plus15 independent
  source comparisons. `owner-final.log` records the exact025 migration below.

The UI now allows a fresh proposal after a stale/closed version, never inherits
its signatures, and refreshes server-derived source totals after money commands.
API approval/engine state reports actual scoped access rather than a fixed false.

Migration025 SHA256:
`4e731a648bae6f3f962a71b146205d9a69930e63aed1f3e6788fdea24f4d2423`.

No managed migration025, hosted financial test or real-group activation has been
performed in this work. Existing approvals naming007–024 did not name025 or
permission to activate real groups. The [prepared managed package](../release-readiness/SC-025-MANAGED-EXECUTION.md)
names rehearsal→staging→production targets, exact025 checksum,56-object role
grants, protected feature preview and synthetic-only financial fixture scope on
the isolated rehearsal. Staging/production stay OFF with empty cohorts.

Apply025/grants before deploying this source. An old pre025 application's strict
runtime inventory checker reports schema mismatch after the extra tables appear;
do not claim full software rollback compatibility without checking that gate.
Emergency stop is an audited database pause, preserving financial history.
After restore, compare raw evidence first, then explicitly pause the restored
policy before connecting application/notification sinks; record that policy/audit
delta separately from original financial preservation.

Remaining managed acceptance: positive synthetic full-cycle flow, Cron/fault and
full-service RPO15m/RTO60m drills, external non-email monitoring, physical devices,
independent financial/security review and observed rollout1→5→25. These are not
certified by local tests or by the prior engine-OFF deployment.
