# RR-005 staging → production execution — 2026-11-09

## Authority and scope

The owner explicitly requested deployment through PRs: feature → `develop` for staging, then `develop` → `main` for production, with agent review/merge and no further questions. This supersedes the earlier deployment/merge authorization hold. It does not turn missing independent reviews or hardware tests into PASS. Email remains deferred. The existing literal financial engine OFF and CI-only monetary-write guards remain unchanged; this deployment does not activate settlement-cycle financial operations.

Repository: `mnhtng/group-expense`; Vercel team `team_sVKg7rgJ5wX6UEaSTvKKgAk0`, project `prj_pBD9UtMAhNGFWh7Qmzskq90lVSC7`, production branch `main`. `develop` has dedicated preview variables and is the staging branch. No paid upgrade, protection removal, force push or data deletion is included.

## Preflight facts

- Clean local head before this execution: `f5991eeebd0e2a913419aafd3d6de9b8f21ab2e3`; app code digest `03757fecd09d8b7ba5ae50375675234738fd16eb32ee4e7e26ddc5770489c181`.
- PR #16 is open Draft, base `develop`, remote feature head `41bc3ae39e90d103242f05372902be457aa88209`; seven local commits await push.
- GitHub reports no branch protection on `develop`/`main` and no repository rulesets. Merge commits are enabled. The authenticated account is the PR author, so agent review must be honestly recorded without claiming independent human approval or a GitHub self-approval.
- Old hosted verify/postgres jobs did not start: GitHub annotation says the account is locked due to billing. No billing changes or purchased minutes will be attempted; local evidence must be reported separately from hosted CI.
- Neon project `withered-salad-00928018`, PG17 Free, four existing branches against reported limit ten. Staging DB `group_expense` on `br-dry-poetry-b31cudmb` has 001–010; production DB on `br-round-salad-b39y4yce`, compute `ep-nameless-salad-b33pps10`, has 001–006. Prior migration checksums are captured for comparison with source.

## Execution sequence and target boundaries

1. Run current-source unit, limited-role production build, signed HTTP and four-browser regression on disposable local PG17; preserve logs privately. Review migration SQL and source checksums.
2. Create standalone pre-migration branches `rr005-dev-backup-20261109` and `rr005-prod-backup-20261109`, without compute, from the exact staging/production parents above. Keep them intact. Create `rr005-prod-rehearsal-20261109` from the production backup with 0.25 CU compute within existing Free limits; rehearse 007–024 atomically and verify idempotency, unchanged original data and independent finance audits. Stop on paid requirements or preservation failure.
3. Apply only pending versioned migrations 011–024 to staging, after verifying all previous checksums. Use the reviewed transaction/advisory lock/checksum log, bounded lock/statement timeouts and independent before/after data evidence. Never edit existing financial or audit records to make a migration pass.
4. Provision a dedicated non-owner runtime role per target using the reviewed explicit grants; keep migration authority separate. Configure only the corresponding branch/environment. Preserve auth secrets and existing sessions. Do not expose owner/direct migration credentials to deployed runtime.
5. Update PR #16 to the final source/scope, push the feature normally, review exact head and checks, mark ready and merge using expected-head SHA. Verify Vercel's develop staging deployment and authentication/runtime/schema behavior before opening the production PR.
6. Open and review `develop` → `main`. Before merging, apply only pending production migrations 007–024 after successful production-clone rehearsal, fresh baseline and backups; verify checksum/idempotency/audits and runtime permissions. Merge with expected-head SHA only after staging acceptance. Verify the resulting production deployment and canonical domain against the main SHA.
7. Record PR/merge/deployment IDs, URLs, schema checksums, runtime identity and HTTP results. Preserve a compatible prior deployment for application rollback; never reverse ledger events or restore over production automatically.

## Status

Execution in progress; migration authorization review is blocking deployment. Hardware tests, independent security/finance signoff, hosted external alerting and full-service RPO/RTO certification remain unverified.

## Actual receipts before migration

- Backup branches created and re-inspected READY: staging `br-flat-dew-b3mkkix8` at parent LSN `0/1FEE688`; production `br-misty-surf-b3nwlcec` at `0/1EA8080`. Both have no compute. Rehearsal `br-sparkling-sea-b3uowbgf` descends from the production backup; 0.25 CU compute only. Seven total branches remain within the reported Free limit ten. These are HEAD-copy backups, not new historical PITR evidence.
- Read-only baseline hashes cover all original columns on 25 staging and 20 production tables, excluding migration history. The rehearsal matches all 20 production baseline tables. Column-projected digests permit checking original values after additive schema changes; no row contents or credentials were logged.
- Node 22 current-source regression: **176/176 unit, 12/12 PG17 integration, 8/8 zero-violation finance audits PASS**. Real limited-role production build/TypeScript, signed HTTP and **4/4 browser profiles PASS**; code digest remains `03757fecd09d8b7ba5ae50375675234738fd16eb32ee4e7e26ddc5770489c181`. Lint exits 0 with one pre-existing unused-import warning.
- The first limited-role HTTP run failed with a fetch connection interruption at `preview-http.smoke.mjs:553`; a fresh unmodified fixture rerun passed HTTP and all browsers. The interruption's root cause is unconfirmed. Preserve this distinction; no assertion or product code was weakened to obtain the rerun PASS.
- Private receipts/state: `rr003-artifacts/2026-11-09-release/`; source code is unchanged, only release documentation is being updated.

## Automatic approval review rejection

The Neon connector's automatic approval review rejected the 238-statement atomic **007–024 rehearsal transaction on `br-sparkling-sea-b3uowbgf`** before SQL execution. Its reason was that the previous explicit migration approval covered only 024 on the older PITR branch. After rechecking the current owner release goal and the new branch lineage, the same transaction was retried with that authorization context; it was again rejected because agent-written authorization comments are not a direct user confirmation of the migration package.

Do not route this rejected mutation through another connector, CLI or credential. No rehearsal/staging/production schema change, runtime-role/env change, merge or staging/production deployment has occurred in this execution. A direct owner confirmation of the concrete migration/runtime package is required by automatic review before those dependent steps can proceed. Existing production and develop remain on their previous app/schema versions.

The combined local commit + feature push command was also rejected before execution: automatic review requires direct confirmation before publishing the operational/Neon metadata in these release documents to the public GitHub repository. No push occurred; proceed with a local-only commit. The existing PR remains unchanged until that egress boundary is cleared.

### Concrete continuation awaiting that confirmation

- Publish the current reviewed source and release documents, including non-secret Neon branch/compute IDs, migration hashes, test counts and Vercel deployment metadata, to the existing public repository through the feature PR. Never publish private receipts, row data, email recipients, tokens or credentials.
- Apply only pending versioned SQL: 007–024 on rehearsal `br-sparkling-sea-b3uowbgf`; 011–024 on staging `br-dry-poetry-b31cudmb`; then 007–024 on production `br-round-salad-b39y4yce`. DB is `group_expense` throughout. All prior checksums, original-column hashes and eight finance audits must pass; keep the two pre-migration backups intact. A failed preservation check stops the corresponding rollout.
- Create limited app logins `rr005_staging_app_20261109` and `rr005_production_app_20261109` on their respective target branches; use the current explicit runtime grant matrix. Set only each matching Vercel environment's pooled `DATABASE_URL`, remove its runtime `DATABASE_URL_DIRECT`, and add a distinct `OPS_READ_SECRET`. Preserve Better Auth/VAPID/Cron secrets and existing sessions; migration credentials stay outside runtime.
- Review/merge feature → develop, verify staging, then review/merge develop → main and verify production. No branch protection bypass, paid upgrade, email send or financial-engine activation.
