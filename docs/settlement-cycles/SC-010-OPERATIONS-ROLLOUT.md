# SC-010 — Settlement cycles operational safety, recovery and staged rollout

**Implementation branch:** `feat/settlement-cycles-bilateral`, Draft PR #16
→ `develop`. **Current verdict: NO-GO for real money.**

The financial-engine kill switch remains a literal
`SETTLEMENT_CYCLE_ENGINE_READY=false`. No feature-branch code
was merged or deliberately deployed to the shared staging or
production environment. No development/production Neon migrations
were performed. This runbook does not authorize those actions.

## 1. Operator goals and strict boundaries

1. Cron is at-least-once: every stage must be independently
   retryable, bounded, durable and monitored. An HTTP 200 only
   means **all observed work below caps succeeded**, not
   proof no future work will ever be created.
2. Recurring invoice generation must finish scanning all active
   templates before cycle metadata can advance. Otherwise an
   invoice whose date belongs to an older period could be
   excluded from an early locked snapshot.
3. Cycle metadata OPEN/REVIEW is not money. A LOCKED snapshot
   cannot be overwritten; a late original bill gets an audited
   SC-006 attribution into a later REVIEW cycle.
4. CASH pending does **not** discharge debt. Only the original
   counterpart's confirmed CASH or a consented immutable BN-004
   two-party NONCASH transaction can reduce obligations.
5. Manager/owner rights NEVER substitute for either signatory's
   approval or original invoice creator's completion.
6. Disaster recovery must preserve original IDs, audit events,
   checksums, confirmed/pending CASH and both-direction NONCASH
   with equal exact integer amounts. NEVER regenerate a second
   obligation by copying a snapshot or replaying an applied
   setoff.
7. Operational telemetry records aggregate counters, durations,
   stage statuses and alert codes only; not passwords, push keys,
   invoices, member names or financial recipient details.

## 2. Implemented safety instrumentation

### Durable, bounded, non-overlapping Cron

New migration:
`db/migrations/023_settlement_cycle_operational_runs.sql`

- `settlement_cycle_operational_runs` records UUID, scheduled/
  manual-replay mode, start/end timestamps and stage counters.
  `running` may transition once to success/partial/failed.
  A terminal record cannot be UPDATEd or DELETEd; interrupted
  running records remain as detectable evidence.
- Session-level PostgreSQL
  `pg_try_advisory_lock(230010,2026)` is held from the
  beginning to final audit commit. A second invocation receives
  HTTP **202 already-running**, with no duplicate run record.
  The same lock protects daily and manually replayed requests.
- Stage order: existing push drain and original monthly recurring
  invoices first; then cycle metadata **only after recurring
  success AND no remaining unscanned templates**; then SC-009
  reminders and a bounded second push drain for newly enqueued
  notifications. Failure in one stage is surfaced without
  presenting a fake CASH or successful cycle completion.
- Recurring scan rotates active templates by
  `recurring_cron_checkpoints.last_checked_at`, with a **201st
  sentinel** to prove whether its 200-template page is complete.
  All 200 checkpoints are updated in one SQL round trip,
  including per-template failure status; strict unique
  occurrence keys still prevent creating a recurring bill twice.
  SC-006's invoice-before-cycle ordering is preserved.
- Cycle metadata rotates by its existing group checkpoints,
  observes a 31st group sentinel for 30/group cap and
  records when one group filled its 24-period work cap.
  Idempotent unique periods and exclusion constraints remain
  enforced in PostgreSQL.
- Any stage error returns **503**; hitting a work cap or
  leaving recurring/cycle scans incomplete also returns **503
  (partial)** with a bounded reason code, rather than
  claiming everything is complete.
  The original daily Cron schedule in `vercel.json` remains
  **02:00 UTC = 09:00 Asia/Ho_Chi_Minh**.
- No new scheduled event source or duplicate Cron registration
  was added. The existing Vercel Cron remains production-only.
  Vercel Git integration has created automatic **feature-branch
  preview** deployments (target=null, not a staging/production
  promotion); these previews may not have feature migrations.
  No manual staging/production deploy or promotion was invoked.

### Protected endpoints

```http
GET /api/internal/push-drain
Authorization: Bearer <CRON_SECRET>

POST /api/internal/push-drain
Authorization: Bearer <CRON_SECRET>
X-Ops-Replay-Reason: retry | backlog | recovery-drill

GET /api/internal/settlement-ops/status
Authorization: Bearer <CRON_SECRET>
```

- The authorization path rejects absent/invalid secrets with
  **401** using equal-length constant-time comparison.
  A missing/unknown manual reason returns **400**.
  All responses are `private, no-store` and `nosniff`.
- Status is a read-only, redacted service-health projection,
  intended for a secured operator monitor. It never exposes
  a group ID, counterparty, invoice or environment secret.
- A healthy status returns **200**, attention/alerts **503**.
  This protected endpoint is NOT public or available via
  user session cookies; the proxy permits only the two
  exact internal endpoints.
- For manual catch-up, first read /status. Replay the same
  endpoint with a valid reason until consecutive runs
  return success and independent source reconciliation is
  still clean. If HTTP 202, do not launch a competing worker.
  Never auto-loop indefinitely; inspect and escalate errors.
  In-app reminders remain blocked in real environments while
  the original financial engine is OFF.

### Redacted operator signal codes

| Signal | Threshold / interpretation | First response |
|---|---|---|
| `NO_COMPLETED_CRON_RUN` | No finished run has been audited | Verify schedule deployed and correct environment |
| `CRON_LAST_RUN_OLDER_THAN_36_HOURS` | Last completed run older than 36h | Inspect Vercel Cron execution and service/DB logs |
| `STUCK_CRON_RUN` | `running` record older than 25 min | Check timeout/connection; never force-apply money |
| `LAST_RUN_NEEDS_OPERATOR_REVIEW` | Last run failed/partial | Review returned stage counts and cap reason |
| `RECURRING_AT_CAP` / `RECURRING_SCAN_INCOMPLETE` | 20 invoices generated, or >200 templates still need checking | Replay bounded Cron; do not review/lock incomplete periods |
| `CYCLES_AT_CAP` / `CYCLE_GROUP_SCAN_INCOMPLETE` / `CYCLE_PERIODS_AT_CAP` | Group or period limit hit | Replay metadata after recurring catch-up |
| `PUSH_AT_CAP` / `REMINDER_PUSH_AT_CAP` | Push still may be backlogged | Retry push safely; never mark pending CASH confirmed |
| `RECENT_GROUP_CHECKPOINT_ERRORS` / `RECENT_RECURRING_CHECKPOINT_ERRORS` | Failures within 7 days | Investigate error category; verify per-source status |
| `DEAD_PUSH_DELIVERIES` | Non-retryable or exhausted push deliveries | Inspect subscription status and notification inbox |
| `CYCLES_AWAITING_HUMAN_REVIEW` | REVIEW older than 48h | Notify authorized manager; never lock automatically |
| `REMINDERS_AT_CAP` | At most 40 reminders in one pass | Replay when explicitly authorized; respect user preferences |

**Important:** the new status endpoint is an observable check
surface, **not an already-configured external alerting service**.
Configure and test a secure monitor separately. Keep bearer secret
in provider secret storage, not repository files, build logs,
URLs, support tickets or screenshots. Operators should not depend
on a public unauthenticated monitor for this endpoint.

## 3. Recovery: severity and response

### Severity 1 — source conservation violation or suspected double payment

1. **STOP the release**: preserve
   `SETTLEMENT_CYCLE_ENGINE_READY=false`. Do not promote or
   flip flags. Disable rollout of new financial operations,
   not user-visible original bill browsing.
2. Record the exact affected group/cycle identifiers in a
   restricted incident system (NOT in public Cron telemetry).
   Capture run ID, deployment SHA, DB branch ID, Neon timestamp
   and read-only `sc007` conservation queries.
3. Do not DELETE/UPDATE confirmed CASH, BN-004 NONCASH source,
   snapshots, approvals or audit events to "fix" the result.
   Pending CASH remains pending until the actual counterparty
   confirms. A dispute does not reverse an already-confirmed
   payment.
4. Snapshot the source DB (Neon PITR/branch) with provider
   controls; investigate or restore into a **new** isolated
   branch. Reconcile all immutable financial and audit records.
5. If genuine compensation is warranted, design a separate
   signed corrective event under a new reviewed ticket; a
   generic SQL rollback is prohibited for already accepted
   financial history.

### Severity 2 — Cron cap/partial/timeout

1. Check `GET /api/internal/settlement-ops/status`, last run
   and warning codes. Check recurring checkpoints before
   cycle metadata checkpoints.
2. Confirm the oldest source invoice dates and whether
   SC-006 has not yet assigned a late invoice. Never
   force-lock a cycle with pending original invoice catch-up.
3. Run **one** explicit manual replay with
   `X-Ops-Replay-Reason: backlog`, wait for the result
   and recheck the status endpoint. Repeat only under an
   active operator session and bounded operational policy.
4. If `already-running`, leave the current worker to
   complete. PostgreSQL advisory lock is session scoped;
   process termination releases it automatically. Do not
   invoke manual `pg_advisory_unlock` on another session.
5. Persistent errors require investigation and a code fix;
   never silently skip source rules or reset immutable
   checkpoints to claim success.

### Severity 3 — push failure or a disputed invoice

- Push jobs do not determine CASH confirmation. In-app
  inbox and original settlement status are authoritative.
  A dead subscription may be replaced through the
  existing preferences/subscription lifecycle.
- An original two-person dispute blocks affected NEW
  payments and confirmation but not unrelated members.
  Only actual reporter/counterparty can resolve or
  withdraw the thread. Manager does not impersonate them.
- If a source is too late for a locked cycle, use SC-006
  audited next-REVIEW assignment without altering the
  locked original snapshot or duplicating its expense.

## 4. Backup & restore drill

### Executed in CI — disposable PostgreSQL 17 ONLY

```bash
CI=true SC010_TEST_ONLY=isolated-pg17 \
  DATABASE_URL=postgresql://test:test@localhost:5432/group_expense \
  bash scripts/sc010-restore-drill.sh
```

The script *refuses* any other CI flag/connection string. It
uses the **PostgreSQL 17** Docker client to
`pg_dump --format=custom` from the disposable CI fixture
into a runner-local temporary file, creates a **new**
`group_expense_sc010_restore` database and
`pg_restore --exit-on-error` into that new database.

`db/sc010-restore-verify.mjs` runs read-only
REPEATABLE READ comparisons of SHA-256 checksums and
row counts of original expenses, obligations, CASH,
settlement allocations, BN-004 NONCASH documents and
allocations, locked snapshot sources, SC-006 late
attribution, SC-009 immutable dispute docs/events,
notification history, SC-010 run log, recurring scan
checkpoints, BN-005 canonical LIVE balances and **all
schema migration file checksums**. Mismatch exits
nonzero. The temporary dump file is deleted by shell
trap even on failure, and is never uploaded to Actions
artifacts.

**Do not run this script on Neon**. It deliberately
exits before any DB calls for a shared/unknown URL.

### Actual Neon rehearsal status at SC-010 completion (2026-11-05)

**Historical snapshot:** the table below describes the state when SC-010 code was completed. Subsequent RR-001 authorized child-only migration evidence is recorded in [RR-001](../release-readiness/RR-001-NEON-MIGRATION-EVIDENCE.md) and in the addendum at the end. Do not treat the earlier pending child migration row as the current database state.

| Item | Status |
|---|---|
| Production parent `br-round-salad-b39y4yce` | UNTOUCHED |
| Shared development `br-dry-poetry-b31cudmb` | UNTOUCHED |
| Created dedicated child `sc010-rehearsal-20261105` | `br-curly-rice-b3xenws6` |
| Parent used for child | Development branch only |
| Initial read-only SQL on child | PASS: 10 installed migrations, baseline rows and balance counts |
| Neon branch-to-development schema compare | PASS: empty schema diff at clone baseline |
| Apply migrations 011–023 to child and compare full data | **NOT RUN — pending separate schema-migration authorization** |
| Shared Neon schema and financial activation | **NOT AUTHORIZED / NO-GO** |

The dedicated branch was cloned for the explicit SC-010
rehearsal preparation. No database schema was changed
or data written on shared Neon. Neon clone baseline
contains only migrations 001–010 and therefore does
**not** prove that settlement migrations 011–023 are
valid on Neon. Do not misrepresent the completed PG17
CI tests as a full managed-Neon migration rehearsal.

Before an authorized Neon schema rehearsal:
- Confirm exact branch and parent IDs in Neon; obtain a
  direct, branch-specific Neon connection and its pooled
  runtime counterpart privately. Never print credentials.
- Require `DATABASE_URL` to be the pooled endpoint
  and `DATABASE_URL_DIRECT` the matching non-pooler
  endpoint; `db/connection.mjs` enforces TLS,
  direct/pooled host identity and database matching.
  Never substitute parent/development/production URLs.
- Record baseline schema checksum and independent
  original ledger summary; separately approve migration
  011–023 against **this isolated child only**.
- Execute `pnpm db:migrate` twice, requiring checksum
  idempotence and no version drift. Repeat independent
  original-source conservation, role/privacy, dispute
  state and SC-004/BN-004/cash checks against the
  child. No CI-only real-money override against Neon.
- Verify no accidental mutation of parent branch
  via read-only schema check, compare original expense/
  obligation totals and frozen-source row hashes.
- Preserve the child for audit until sign-off; deleting
  a Neon branch is destructive and needs an explicit
  user authorization. Branch computes may incur cost.

### Managed production recovery — not executed

- Before production release, establish a retention/RPO/
  RTO policy and verify Neon PITR/snapshot support and
  billing plan. Create and test a restore in a **new**
  branch using the provider-approved process.
- Verify restore point, immutable original source,
  applied NONCASH conservation and CASH confirmation
  independently; do NOT restore over the original
  production branch without a separate incident
  commander authorization and loss-impact assessment.
- Database migrations are forward-only; rolling back
  application code is not equivalent to deleting
  a migration. No `DROP TABLE` of financial
  history, no automated reverse ledger writes.
- Never disclose connection strings in chat, logs
  or committed configuration.

## 5. Launch decision matrix (ALL REQUIRED)

| Gate | Status as of SC-010 | Required evidence |
|---|---|---|
| Hard financial engine OFF in code | PASS | Compile-time constant and CI negative tests |
| Original CASH and two-sided NONCASH conservation in disposable PG17 | PASS | SC-007 before/after audit and 16 concurrent writer race |
| Runtime serialized/audited Cron and safe catch-up | PASS IN CI | Scheduled/manual exclusive lock, failure/saturation/replay tests |
| Logical backup and new-database restore | PASS IN DISPOSABLE PG17 ONLY | Exact SHA-256 proof of original sources, source events and migration checksums |
| Cron monitored outside development | **PENDING** | Secured uptime/alert integration and tested acknowledgement path |
| Isolated Neon full migration and recovery rehearsal | **PENDING** | Child-specific migration, diff, source conservation and restore drill |
| Physical browser/mobile PWA consent/focus/touch tests | **PENDING** | Chromium, WebKit, iOS, Android regression, authz and ARIA interactions |
| Security/finance approval | **PENDING** | Exact SHA reviewed, threat/risk sign-off, legal/privacy checks |
| Production point-in-time backup and recovery proof | **PENDING** | Recoverable backup/branch, verified RPO/RTO, finance reconciliation |
| Staged/cohort release decision | **NOT AUTHORIZED** | Owner explicitly approves deployment, migration and activation |
| PR #16 / shared Neon / staging / main | **NO ACTION** | Stay Draft; no merge/deployment/migration |
| Actual money release | **NO-GO** | Independent future release decision |

**If any required gate is red, the release is NO-GO.**

## 6. Future staged release procedure — design only, NOT executed

1. **Preparation:** freeze and review the exact PR SHA.
   Review migration SQL 011–023 and production schema
   drift. Require CI + isolated Neon rehearsal + device
   E2E + two-person accounting and security signoff.
2. **Backup:** record recovery point/LSN, independently
   restore a representative production snapshot in
   a new isolated branch and run original-ledger
   conservation checks.
3. **Staging rehearsal:** after a separate written approval,
   migrate **staging only**, deploy the tested SHA to
   staging, test mobile pair approval + disputed-source
   concurrent CASH/NONCASH, check Cron alerts,
   run replay after simulated interruption.
4. **Initial production:** require a new reviewed change
   implementing a **secure production release gate**;
   this ticket deliberately does NOT implement a
   mutable runtime bypass for `SETTLEMENT_CYCLE_ENGINE_READY=false`.
   With owner approval, stage one reviewed Vercel
   production build **without** assigning domains
   (`vercel deploy --prod --skip-domain`), test,
   then promote that **same** verified build.
5. **Small cohort:** only explicit opted-in groups;
   validate per-source audit, real counterpart consent,
   no duplicate source, no third-party netting,
   unresolved disputes and pending CASH before
   enrolling any additional group.
6. **Expand conservatively:** expand 1 → 5 →
   25 explicitly approved groups only after
   observing at least a full settlement period
   with zero money conservation errors and
   completed operational alert response.
   Avoid automatic enrollment of existing groups.
7. **Recovery/rollback:** roll back app code to a
   tested previous Vercel deployment when required,
   but preserve append-only DB history and
   future-only migrations. Pause new finance
   operations while investigating; never
   unapply an executed noncash document by
   force-modifying obligations or snapshot history.

**Current state:** documentation and CI instrumented,
not a production rollout. Only an explicit future
authorization can move any pending gate forward.


## 7. Post-SC-010 addendum — RR-001 isolated-Neon migration (2026-11-05)

A separately requested and authorized **RR-001** rehearsal has now applied versioned SQL migrations **011–023** to the dedicated `sc010-rehearsal-20261105` child (`br-curly-rice-b3xenws6`) **only**. Child now records 23 matching SHA-256 migration checksums; `development` remains at 10, `production` at 6. All 8 independent SC-007 original-source read-only queries return 0 violations and full-row SHA-256 values of original `expenses` and `obligations` are unchanged. The executed SQL was applied through isolated branch-pinned Neon transactions; a separate `pnpm db:migrate` command was **not** run against Neon. Noncash/locked-snapshot/dispute rows on this baseline child are empty, so those positive paths remain proven in disposable PG17 CI, not on managed Neon.

**This completes the isolated child schema-migration prerequisite only.** It does NOT establish provider-managed Neon backup/PITR restore, full role/privacy browser E2E, production monitoring, finance signoff, staging acceptance or production release authorization. The release decision stays **NO-GO**, engine compile-time OFF, and PR #16 stays Draft. No schema change was made on either shared Neon branch, and no original financial ledger entry was written.

Evidence: [RR-001 execution and limitations](../release-readiness/RR-001-NEON-MIGRATION-EVIDENCE.md) · [RR-001–RR-005 backlog](../release-readiness/BACKLOG.md).
