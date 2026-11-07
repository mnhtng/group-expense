# RR-003 — Managed Neon recovery, preservation and operations monitoring

**Date:** 2026-11-07  
**Branch:** `feat/settlement-cycles-bilateral` → Draft PR #16 against `develop`  
**Current gate:** **PRECHECK / TOOLING PREPARED — PROVIDER RESTORE NOT PERFORMED; NO-GO**.  
**Absolute boundaries:** Do not enable `SETTLEMENT_CYCLE_ENGINE_READY`, write to production/development/shared Neon, replay financial transactions, merge PR, run `scripts/sc010-restore-drill.sh` on Neon, change snapshot schedules or promote any restored branch.

## 1. Read-only live provider inspection, 2026-11-07

Performed via the connected Neon provider API, not inferred from a local PostgreSQL build:

| Check | Provider observation | Consequence |
|---|---|---|
| Project | `withered-salad-00928018`, `group-expense` | Pin every RR-003 operation to this ID |
| Engine | PostgreSQL 17, `aws-ap-southeast-1` | Plan version/region compatible recovery |
| Plan | `free_v3` | Provider limits and backup plan must be verified before promises |
| `history_retention_seconds` | **21600 seconds = 6 hours** | A point older than 6h is outside the currently reported history window |
| Provider snapshots | `list_snapshots = []` (zero) | No existing snapshot recovery artifact was verified |
| Auto snapshot schedules | Empty on production, shared development and RR-001 child | No scheduled snapshot evidence on any checked branch |
| RR-001 child | `br-curly-rice-b3xenws6`, `sc010-rehearsal-20261105` | Source for a future **separately approved** isolated test |
| Source's parent | `br-dry-poetry-b31cudmb` (`development`) | **Never use as a restore target** |
| Production/default | `br-round-salad-b39y4yce`, primary/default | **Never use as a restore target** |
| Child compute | `ep-holy-hill-b39kdqz6.c-4.ap-southeast-1.aws.neon.tech` | Only checked source compute for read-only baseline |
| Child SQL (read-only) | 23 migrations; 2 original expenses, 2 obligations, 0 operational run records | Existing state is a limited test fixture, not a positive CASH/NONCASH/alert restore demonstration |

**Distinctions:** Zero snapshots does **not** prove that Neon timestamp-based PITR is unavailable; managed historical restore must be actually exercised. Six-hour history is a *recovery window*, **not automatically a measured RPO**. RTO cannot be inferred from plan tier, restore API availability or a synthetic local dump. A snapshot schedule is a separate backup control.

**Important tool capability constraint observed:** The connected Neon `restore_snapshot` action requires a real `snapshot_id`, but `list_snapshots` currently returned **zero**. The separate `create_branch` action clones a parent's **current HEAD**, not a specified older point. Therefore **neither action can currently demonstrate recovery to a chosen past timestamp** with the available snapshot inventory. Do not create a HEAD clone and call it PITR. An operator must first verify eligible historical restore/snapshot functionality on this Free-plan project and obtain an approved restorable snapshot ID or an explicitly supported historical-restore API; snapshot creation or upgrading a plan is a separate authorized action. Never call `finalize_branch_restore` (it can swap names/reassign computes).

**Risk:** With a history window of only 6h, a corruption detected later than 6h may no longer have a restorable historical point unless some independently verified backup exists. User or accountable operator must declare acceptable RPO/RTO before any release claim, and decide whether the Free-plan retention and lack of snapshots meet the actual business risk; no policy target is invented by this ticket.

## 2. Read-only tooling implemented

1. `db/rr003-recovery-policy.mjs`: pure metadata evaluation; rejects changed project identity, missing/incorrect child, protected/default source, changed branch ancestry or invalid history retention. Returns aggregate/metadata-only summary; **always** `decision:"NO-GO"`, `pitrAvailabilityVerifiedByRestore:false`. `assertRestoreBranchPlan` rejects production/development/source as destinations and an out-of-retention timestamp. No network or SQL.
2. `tests/rr003-recovery-policy.test.mjs`: Free-tier 6h/no-snapshot fixture and negative authorization/identity/retention cases. Does not create or restore a branch.
3. `db/rr003-restore-compare.mjs`: **future read-only restore verifier**; two separate steps `capture` (source → local manifest of SHA-256 digests/counts only), `verify` (new restored child → compare). Requires explicit project/source, source's **exact pinned direct Neon endpoint**, new target branch ID and **provider-attested exact target host**; refuses prod/dev/source destination, wrong DB, insecure endpoints and non-TLS connections. All SQL executes in `REPEATABLE READ READ ONLY` with 10s statement timeout; 15 whitelisted financial categories including migrations, obligations, invoices, CASH/NONCASH allocations, snapshots, adjustments, disputes, notification history, Cron runs and BN-005 balances. Reads are capped at **10000 rows per category** and fail closed above the bound. Never logs a ledger row or database URL; local manifest writes use exclusive create and mode 0600.
4. `tests/rr003-restore-compare.test.mjs`: compares synthetic complete digests and refuses mismatched categories, parent/source targets, wrong host/TLS and mutated financial fingerprints. **A matching test fixture is not provider restore evidence**.
5. `scripts/rr003-ops-monitor.mjs`: opt-in **read-only** authenticated GET of `/api/internal/settlement-ops/status`. Requires exact HTTPS host approved in `RR003_APPROVED_HOST`, no credentials in URL, `CRON_SECRET` only in Authorization header, no redirect, 8s timeout, no sensitive response printing. Distinguishes 200 healthy, 503 attention, 401/403 auth issue, malformed body and transport/TLS failures. A healthy 200 also requires `financialEngineReady=false` and `releaseDecision="NO-GO"`; no ledger or Cron replay. Does **not** create a monitor provider, recurring scheduler or external notification.
6. `tests/rr003-ops-monitor.test.mjs`: synthetic HTTP/authorization/response guards.
7. Existing, unchanged SC-010 `GET /api/internal/settlement-ops/status` is bearer-only and reports 200/503 with redacted metrics; SC-010 already has 25-minute stale-run and 36-hour missing-run alerts. A monitor that does not actually run and deliver an alert is **not** an RR-003 alerting PASS.

## 3. Future provider restore — pre-authorized *plan only*, NOT an execution

**Stop here until a separate explicit authorization names:** exact project `withered-salad-00928018`; source **isolated** branch `br-curly-rice-b3xenws6`; new unique restore branch name; chosen recent UTC restore point still inside the provider history window; budget/cost; independent reviewer; and confirmation production/default/development may never be overwritten, renamed, reset, or promoted. Generic 'continue' does not authorize provider mutation.

After authorization, an operator may follow these **future** steps:

1. Re-fetch provider project history retention and branch topology; record immutable source branch metadata and a clean baseline. Ensure no concurrent writes to the isolated source during baseline and the chosen PITR point; otherwise a live source-vs-restored hash equality is **not** a valid PITR test. Existing `br-curly-rice...` has only original rows and no operational run: positive finance scenarios require a separate test dataset if expected.
2. Capture a local read-only manifest shortly before the chosen restore point using securely injected, branch-specific source connection environment. **Never paste credentials into GitHub, terminal logs or chat**. The capture command (placeholder environment is intentionally not filled here):
   ```bash
   # Environment privately supplied: RR003_PROJECT_ID, RR003_SOURCE_BRANCH_ID,
   # RR003_SOURCE_DATABASE_URL with sslmode=require or verify-full.
   # No DATABASE_URL pointing to production/shared Neon!
   node db/rr003-restore-compare.mjs capture rr003-artifacts/pre-restore.json
   ```
   Do not commit or upload the file; it stores only per-table row counts and hashes, not raw rows.
3. **BLOCKED until an eligible recovery object/API exists.** After a specific approval and verification of the chosen restore mechanism, restore an approved historical snapshot (or an independently verified timestamp-capable provider operation) into a **new independent child**, never an existing `target_branch_id` and never finalize/swap/reassign production compute. `restore_snapshot` currently needs `snapshot_id` and none is listed; `create_branch` only clones current HEAD. Neither action was invoked here. Preserve provider operation receipt, source branch, exact restorable point and observed start/finish times. If the only available action is HEAD clone, **stop and report PITR NOT VERIFIED**, not PASS.
4. Read provider's new branch `id`, `parent_id` and compute `host` using `get_branch` and `list_branch_computes`. Only after confirming they match the approved IDs/host, privately inject `RR003_TARGET_BRANCH_ID`, `RR003_TARGET_PARENT_BRANCH_ID`, `RR003_TARGET_HOST`, `RR003_RESTORE_DATABASE_URL`, `RR003_RESTORE_POINT_UTC`, `RR003_REVIEWED_AT_UTC` and `RR003_HISTORY_RETENTION_SECONDS`. `verify` is a read-only statement-only comparison:
   ```bash
   node db/rr003-restore-compare.mjs verify rr003-artifacts/pre-restore.json
   ```
   Fail closed on any different financial row, migration checksum, missing category, stale PITR point or connection mismatch. **Even 15/15 matched does not establish whether the requested point was correctly restored** without the actual provider operation receipt, time-of-restore mapping and quiescence evidence.
5. Verify original/immutable row count and SHA-256 conservation, positive CASH and NONCASH scenarios if independently present, exact source lineage, and no drift in the source branch after restore. No replay/rollback of applied settlement, approval or immutable audit.
6. RPO = verified elapsed age between the latest reliably recoverable source state and recovery point; RTO = observed time from declared incident start (UTC) until recovered service is verified healthy by an independent tester. Record timings in ISO 8601, with declared policy thresholds and actual measured values. Do not hardcode 'zero loss' or promise a fixed RTO.
7. Store redacted provider receipt, 15-class audit summary and reviewer signoff in a scoped evidence record; keep restore branch for review and **do not delete it** without explicit approval. `SETTLEMENT_CYCLE_ENGINE_READY` stays false. Overall RR-003 can only PASS after provider restore + independent DB verification + alert delivery.

**Important:** The standard `scripts/sc010-restore-drill.sh` explicitly refuses non-disposable local PG17 and must **never** be redirected at a Neon endpoint.

## 4. External monitoring gate

The SC-010 status API is internal and protected. A monitor configured to call it must keep `CRON_SECRET` out of URL/query/logs and use the application's isolated approved **HTTPS** origin. It is read-only; do not send HTTP POST to the Cron/replay endpoint.

Local safe test fixture (no network and no real secrets):
```bash
node --test tests/rr003-ops-monitor.test.mjs
```

Live check requires operator-approved hostname and secret manager injection; there is no approved monitor origin in this ticket. The CLI **refuses** to send a request without the explicit `RR003_MONITOR_RUN=approved-read-only` opt-in:
```bash
# RR003_STATUS_URL=https://<approved-host>/api/internal/settlement-ops/status
# RR003_APPROVED_HOST=<the-same-approved-host>
# CRON_SECRET supplied privately, not hardcoded or printed
RR003_MONITOR_RUN=approved-read-only node scripts/rr003-ops-monitor.mjs
```

**Pass conditions:** with valid secret, healthy sample returns 200; a controlled SC-010 partial/failed/overdue condition returns **503** and the appropriate sanitized code; missing/incorrect secret returns **401** without leaking data; monitor delivers an external alert, the on-call operator acknowledges it and records the incident/timing. The exact alert provider, target, delivery method, escalation and accountable person are **not configured here**, so the monitoring gate remains PENDING. Never claim 'alerts working' merely because a local response classifier test passed.

## 5. Safe status and required next evidence

| Gate | Status | Evidence needed |
|---|---|---|
| Project/branches/history inventory | **READ-ONLY COMPLETE** | Live Neon metadata reviewed, 6h history, three branches |
| Current schema and original record counts | **READ-ONLY COMPLETE** | Isolated child: 23 migrations, 2 expenses/2 obligations, no Cron runs |
| Snapshot backup strategy | **BLOCKED** | Snapshot availability/plan, retention adequacy, separate approval for changes |
| RPO/RTO operational targets | **UNDECLARED** | Human owner sets required RPO/RTO based on business impact |
| Provider PITR restore | **NOT EXECUTED** | Specifically approved new child, provider receipt and proof of historical point |
| Financial restore conservation | **NOT EXECUTED** | 15-class exact comparison on actual restored branch + independent finance audit |
| Live 200/503 + external alert/acknowledgement | **NOT EXECUTED** | Approved HTTPS target, protected monitor, controlled fault and delivery evidence |
| RR-003 final gate | **NO-GO** | All above PASS; no guesswork |
| RR-004/005 | **NOT STARTED** | Separate tickets; staging/production release not authorized |

**Relevant reference:** [SC-010 operational safety](../settlement-cycles/SC-010-OPERATIONS-ROLLOUT.md), [RR-001 isolated Neon migration evidence](./RR-001-NEON-MIGRATION-EVIDENCE.md), [release backlog](./BACKLOG.md).

**Never put a real bearer, Neon connection string, user IDs, group IDs, invoice descriptions or financial amounts into public evidence, CI artifact or PR discussion.**
