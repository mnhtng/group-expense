# SC-025 managed execution — 2026-11-10

The owner explicitly approved the complete [execution package](SC-025-MANAGED-EXECUTION.md)
for source `4c1bd66b3e09c743131f87c4ab0774460fee4f84`. App code digest remains
`c440984adbc97b16f6837d292aca060edff5848943ffc3da5e3ef3f00ef360ae`;
documentation-only receipts do not change it. [PR21](https://github.com/mnhtng/group-expense/pull/21)
targets develop. No real group activation or email is authorized by this package.

## Rehearsal: PASS, returned to paused state

- Used existing `br-sparkling-sea-b3uowbgf`, database `group_expense`, compute
  `ep-late-block-b3ss7ozi`, 0.25CU. Project reports `free_v3`, seven branches
  against limit10. Both earlier backup branches remain intact; no branch or
  compute upgrade was created.
- Applied only025, SHA256
  `4e731a648bae6f3f962a71b146205d9a69930e63aed1f3e6788fdea24f4d2423`.
  All001–025 hashes match. Transaction-scoped migration lock,5s lock timeout,
  30s statement timeout, repeatable-read and temporary before/after evidence
  assert **42 original business relations unchanged**. Authentication, profiles,
  invite token hashes, notifications/preferences and push secrets/diagnostics
  were excluded from those comparisons. No persistent helper table was added.
- New `sc025_preview_app_20261110` was created read-only first, then given the
  explicit56-object/29-guard matrix. Actual runtime is a separate non-owner
  login with no memberships/admin/DDL/temp/security-definer/future broad grants;
  policy control/cohort/history remain SELECT-only.
- Protected preview `dpl_FYygXT8aDCxzzPHKBpduzbPsK38r`,
  [immutable URL](https://group-expense-hpi1vwnqz-mnhtngs-projects.vercel.app),
  attests source4c1bd66, correct role and connection fingerprints. Four new
  secrets and one non-secret auth-origin setting are scoped only to this
  feature branch. Existing staging/production secrets and SSO are unchanged.
- **58 signed HTTPS requests across ten completed phases PASS.** Three new
  synthetic accounts, one new group and three original synthetic invoices
  were created through real auth/group/invoice APIs. Approved historical
  settings/schedule and admin fixtures reference only that new group/accounts.
  Monetary test flags, mail and VAPID are absent from the preview.
- Default OFF, cohort-with-global-OFF, group opt-out, an unrelated admin and a
  single signature cannot authorize NONCASH. Opt-out closes the old proposal;
  a fresh version requires both independent synthetic sessions to approve.
  Simultaneous same-key POSTs return200/201 for **one** NONCASH document.
  Pausing blocks new writes; same-key retries return committed evidence.
- Residual and ordinary-cycle CASH each create pending documents. The initiator
  cannot self-confirm. The actual synthetic counterpart confirms; retry while
  paused returns the same IDs. Final fixture has one NONCASH document, two
  confirmed synthetic CASH documents and zero remaining/reserved balances.
  This simulates manual confirmation; it does not transfer real bank funds.
- All eight independent financial audits have zero violations. All42 original
  business relations outside the precisely identified new synthetic group match
  their baseline; the three new original obligations also retain full-row hashes.
  Final control is OFF, revision7, cap1; admitted count0. Synthetic immutable
  documents/history are retained. Runtime/health exposes counts, not cohort IDs.

The initial automatic push preview started before its new branch secrets existed
and returned401 to the read token. The replacement above was built after config
and passed. A later Neon connector role-authentication error was checked through
the actual app pool and a separate `pg` connection using only the new limited
role; both passed. No owner connection URL was exported or protection relaxed.

## Staging schema/runtime policy: PASS; app deployment pending

On `br-dry-poetry-b31cudmb`,025 was applied atomically with all42 original business
relations preserved,25/25 source checksums and eight zero-violation audits.
Existing `rr005_staging_app_20261109` now passes56 objects/29 guards as its actual
login. Password, pooled runtime URL, auth/VAPID/Cron/OPS secrets and sessions were
preserved. Policy remains OFF/cap1/revision1 with an empty cohort. No staging
synthetic financial records or group admission were created.

Production025 and application deployment remain pending until staging app PASS.
The old pre025 application's strict inventory endpoint is temporarily incompatible
with the extra objects; do not claim a certified old-app rollback on025.

## Hosted CI and remaining gates

Runs42819623108/42819623386 have no executed job steps. Their current annotations
say: “The job was not started because your account is locked due to a billing
issue.” Local182 unit/13 integration/build/HTTP/four-browser/restore evidence is
separate from hosted CI. No billing changes, paid upgrade or protection bypass.

Private source-bound receipts, cookies and credentials remain under ignored
`rr003-artifacts/2026-11-10-activation/`, not in Git. Independent human security/
finance signoff, physical devices, external non-email monitoring, full-service
RPO≤15m/RTO≤60m and observed real-group1→5→25 rollout remain unverified.
