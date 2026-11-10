# SC-025 — managed rehearsal and application release package

Status: prepared, **not executed**. Local source is on
`feat/settlement-cycle-activation`, based on main PR20 (PWA preserved).
The final reviewed source commit and local results are recorded in
[SC025 implementation evidence](../settlement-cycles/SC-025-CONTROLLED-ACTIVATION.md).

## Why a separate approval

The previous explicit provider package named migrations007–024 and excluded
financial-engine activation. This package introduces025 and permits positive
financial tests **only for newly created synthetic accounts/groups on the named
isolated rehearsal branch**. It does not select or activate a real user group.
Email stays deferred. Stop before any paid upgrade or preservation mismatch.

## Fixed targets and artifacts

- Neon project `withered-salad-00928018`, database `group_expense`.
- Reuse existing isolated production-clone rehearsal
  `br-sparkling-sea-b3uowbgf`, 0.25CU. No new branch or compute upgrade.
- Apply **only** `025_settlement_engine_rollout.sql`, SHA256
  `4e731a648bae6f3f962a71b146205d9a69930e63aed1f3e6788fdea24f4d2423`.
  Existing001–024 checksums must match before applying025 atomically with its
  migration receipt. Repeated execution checks checksums and makes no change.
- Runtime SQL is `buildRuntimeGrantSql` in `db/rr004-runtime-policy.mjs`:
  56 objects,29 guards, SELECT-only operator control/cohort/history.
- Rehearsal role `sc025_preview_app_20261110`: dedicated non-owner login,
  created read-only first, then the reviewed explicit grants. Migration authority
  remains separate. Never publish its password or an owner connection string.
- Vercel team `team_sVKg7rgJ5wX6UEaSTvKKgAk0`, project
  `prj_pBD9UtMAhNGFWh7Qmzskq90lVSC7`. Four new secrets only for the feature
  branch preview: pooled `DATABASE_URL`, `BETTER_AUTH_SECRET`, `CRON_SECRET`,
  `OPS_READ_SECRET`. Set `BETTER_AUTH_URL` to the exact protected preview origin
  as non-secret branch configuration. No direct URL, mail, VAPID or test flags.
  Preserve SSO, other preview variables, staging/production auth and sessions.

## Sequence and acceptance

1. Read current branch lineage/schema and existing financial audit counts.
   Capture original business-row preservation evidence excluding authentication,
   profiles, verification, push secrets/diagnostics and invitation token hashes.
   Logs contain only checksums, counts and preservation booleans.
2. Apply025 on rehearsal; verify001–025 hashes, disabled control, empty cohort,
   unchanged original business rows and eight zero-violation financial audits.
   Provision the limited runtime role and verify the actual login against56
   objects/29 guards, no ownership/admin/DDL/temporary/security-definer access.
3. Publish source/plan and non-secret operational metadata through a feature PR;
   create the protected feature preview from its reviewed exact SHA. Use the
   existing short-lived Vercel OIDC access path; do not remove protection.
4. Create three new synthetic accounts through real authentication, one new
   synthetic group and synthetic invoices through authenticated application
   routes on this preview only. Historical schedule/settings fixtures, if needed
   to test an already-ended period, apply only to those new synthetic IDs.
   Never backdate or alter an existing user's configuration or original ledger.
5. Verify default OFF and opt-in-only denial. Admit exactly the new synthetic
   group (cap1), enable only this isolated policy, obtain independent signed
   requests from the two synthetic parties, apply NONCASH once, create residual
   and ordinary cycle CASH pending documents, and confirm with the actual other
   synthetic party. Exercise one-signature/admin denial, concurrent same-key
   retry, pause/new-write denial, replay of committed results and unchanged
   original obligations. No mail or external push is sent.
6. Reconcile all eight audits, verify original business data excluding precisely
   tracked new synthetic IDs, and verify runtime/health redaction. Pause the
   rehearsal control and mark its synthetic admission false. Preserve synthetic
   immutable financial/audit evidence; do not delete or reverse it for cleanup.
7. Only after rehearsal PASS: stage025 and the same explicit role grant matrix
   on staging `br-dry-poetry-b31cudmb`, existing role
   `rr005_staging_app_20261109`. Keep control OFF/cohort empty. Review/merge
   feature→develop with expected-head SHA, verify deployment/auth/schema/runtime
   and original data. No staging financial fixture or real-group admission.
8. Only after staging PASS: repeat025/grants on production
   `br-round-salad-b39y4yce` (compute `ep-nameless-salad-b33pps10`), existing
   role `rr005_production_app_20261109`, control OFF/cohort empty. Review/merge
   develop→main and verify canonical production. Preserve existing backup
   branches and auth/VAPID/Cron/OPS secrets; no runtime URL change is needed.

The existing GitHub account billing lock may prevent hosted jobs from starting;
report that separately from local results. Do not purchase minutes or claim an
agent COMMENT is independent human approval. No force push or protection bypass.

## Failure, recovery and real rollout boundary

Use bounded SQL lock/statement timeouts. Stop that target on migration/hash,
permissions, preservation, financial audit or staging failure. Do not deploy new
source before025 and grants exist. Retain the old deployment and backups; pause
policy as the immediate financial stop. Pre025 strict attestation rejects the
extra inventory, so old-app rollback is not certified on025. Prepare/verify a
schema025-compatible rollback before any actual group activation.

After restore, compare untouched raw evidence first. Pause the restored operator
policy and record the resulting policy/audit delta before attaching application
or notification sinks. Never restore over production automatically.

**A real group remains a later explicit decision:** named group/owner opt-in,
independent security/finance review, real-device acceptance, non-email external
monitoring and service RPO≤15m/RTO≤60m evidence. Caps1→5→25 require observation
and reviewed operator changes. No automatic admission, escalation or rollout
timer is included in this package.
