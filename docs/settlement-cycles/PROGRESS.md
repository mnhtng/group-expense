# Delivery ledger — one ticket per conversation

## Baseline
- Source `develop`: `bc8aa84bb3ff7be6bc3719237fc55d9f80aa2bb5`.
- Work branch: `feat/settlement-cycles-bilateral`.
- Review PR: https://github.com/mnhtng/group-expense/pull/16 (**DRAFT, NOT MERGED**).
- **NO STAGING / PRODUCTION DEPLOYMENT, NO SHARED NEON MIGRATION** in this conversation.

## 2026-11-04 — SC-001: DONE (feature branch; code review pending)

**Delivered**
- `011_settlement_cycle_feature_gates.sql`: absent settings row means OFF; flags cannot enable bilateral unless cycle requested; one active grant per group/member; historical grants; append-only config audit.
- `lib/settlement-cycles/settings.ts`: group-locked updates with version checks, strict actor membership, owner-only grants and independent delegated configuration; no role-based admin bypass; engine gate **hard-disabled** until a reviewed later release.
- `lib/settlement-cycles/http.ts`, authenticated API GET/PATCH settings and POST manager grant/revoke; malformed JSON, unknown fields and stale versions fail closed.
- `components/groups/settlement-cycle-settings-panel.tsx` integrated into group management for eligible users only; explicit **PREPARATION ONLY** notice (not an active finance mode).
- `lib/groups/membership.ts`: revoke grants in the same transaction when member departs; revoke all old grants on ownership transfer.
- Unit/SQL integration/HTTP smoke coverage, including race on settings version, admin without grant denied, owner-only delegation, revoke, transfer, leave/rejoin, archive and 0 ledger modifications.

**Verifications (on code commit `6057bf2a6411ac9d9d5bfdd0ceb2ec1d6ad7f5a6`)**
- CI: https://github.com/mnhtng/group-expense/actions/runs/41836725130 — SUCCESS (`pnpm lint`, `pnpm typecheck`, `pnpm test:unit`, `pnpm build`).
- PostgreSQL CI: https://github.com/mnhtng/group-expense/actions/runs/41836725109 — SUCCESS (run `pnpm db:migrate` **twice** with checksum validation, `pnpm test:integration`, `pnpm build`, `pnpm test:http`).
- Database: disposable PostgreSQL 17 service in GitHub Actions, **not** real users' financial database.
- Scope review: PR changes contain no writes to existing `obligations`, `settlements`, `settlement_allocations` or `expenses`.

**Remaining gates**
- Human review of PR #16 before any merge.
- Schema 011 must be migrated on an isolated staging/test database before staging deployment; **not applied** to shared Neon development or production during this ticket.
- No set-off calculation/approval/ledger execution exists yet. Even if the preference is saved as true, `effectiveEnabled` remains false.
- Do **not** flip the engine-ready gate to true until SC-002 through SC-007 financial correctness and security sign-off.

## 2026-11-04 — SC-002: DONE (feature branch; review pending)

**Ticket scope only:** cycle calendar schedule configuration. No SC-003 cycle creation,
SC-004 snapshot, BN-001 calculator, or financial ledger changes.

**Delivered**
- `012_settlement_cycle_schedule.sql`: separate configuration head with
  compare-and-swap version, historical/pending schedule revisions, audit events,
  UNIQUE/FK/CHECK guards and PostgreSQL triggers preventing mutations of
  effective revisions and changes/deletions of audit events.
- `lib/settlement-cycles/calendar.ts`: pure weekly (7d), biweekly (14d),
  monthly with 29–31 short-month clamp and manual (no automatic range).
  Local [start,end) semantics, strict ISO validation and IANA local midnight
  converted to a unique UTC instant (reject missing/ambiguous DST midnight).
- `lib/settlement-cycles/schedule.ts`: owner or active authorized delegate
  may set a schedule only in the future; existing active periods cannot be
  split and a timezone cutover must have identical old/new UTC midnight.
  One future pending plan may be superseded (audit retained).
  Writes use group row lock, `expectedVersion`, atomic transaction and audit.
- `app/api/groups/[groupId]/settlement-cycle/schedule/route.ts`:
  session-authenticated, strictly validated GET/PATCH without direct ledger access.
- `components/groups/settlement-schedule-panel.tsx`:
  d/m/yyyy entry, frequency/timezone, next period explanation and clear
  **configuration only, engine OFF** notice in Manage Group.
- Targeted tests: `settlement-schedule-calendar.test.mjs`,
  `settlement-schedule.integration.mjs`, HTTP scenario added to
  `preview-http.smoke.mjs`; migration list updated.
- `SC-002-SCHEDULE.md`: exhaustive calendar, version and safe cutover contract.

**Verified through final SC-002 code/test commit `cfb12b6ac92d771c0cf9fba222c8bf7f941a5893`**
- GitHub CI: https://github.com/mnhtng/group-expense/actions/runs/41856078827 —
  SUCCESS (lint, Next.js typecheck, unit, production build).
- PostgreSQL integration + HTTP:
  https://github.com/mnhtng/group-expense/actions/runs/41856078768 —
  SUCCESS (migration twice/checksum, integration, build, HTTP smoke).
- SQL CI creates **disposable PostgreSQL 17**, not shared Neon.
- Negative cases: unauthorized admins, stale delegate, invalid zones/dates/JSON,
  backdates, misaligned biweekly changes, timezone mismatches, concurrent
  same-version updates, duplicated future plans and audit mutation attempts.
- No financial tables or `SETTLEMENT_CYCLE_ENGINE_READY` modified.
- PR #16 was explicitly converted to **Draft**; remains unmerged.

**Deployment gates:** Not deployed, no migration 012 on shared Neon
development/production, and no changes to `main` or `develop`.

**Known policy constraints:** Changing a monthly schedule reanchors its
preferred day to the new cutover date. For a current day-31 monthly plan,
choose a matching upcoming 31st-day boundary when possible to preserve
future day-31 behavior. Timezone changes with different UTC midnights
are rejected, not approximated.

## 2026-11-04 — SC-003: DONE (feature branch, verification complete)

**Ticket scope:** metadata-only cycle state machine. No SC-004 eligible
obligation snapshot, no BN-* netting, no settlement/payment changes.

**Implementation (branch `feat/settlement-cycles-bilateral`)**
- Migration `013_settlement_cycle_lifecycle.sql`: `btree_gist` exclusion
  on UTC half-open ranges per group; FK pins a cycle to the same group's
  schedule revision; immutable cycle identity and append-only lifecycle audit;
  PostgreSQL check/unique/version constraints; idempotency keys for manual
  cycles, fair Cron checkpoints.
- Service `lib/settlement-cycles/lifecycle.ts`: OPEN (v1) -> REVIEW (v2)
  after period end, nothing further. All writes hold the group row lock.
  Owner/delegate permissions and current opt-in are checked inside the
  transaction. Missing/disabled settings fail closed. Last explicit
  OFF -> ON audit event bounds both manual and Cron creation; past intervals
  are not silently imported. Manual retry with the same request key is
  idempotent, changing its payload is rejected.
- `/api/groups/:groupId/settlement-cycle/cycles` GET/POST;
  `/cycles/:cycleId/review` and `/cycles/refresh` POST. Validated JSON,
  session-derived actor, 403/404/409 on invalid role/state/period.
- Existing authenticated daily Cron route now calls bounded
  `processCycleMetadataCron(30,24)`; no new Vercel Cron, and no money action.
  A per-group checkpoint rotates groups fairly to avoid starvation.
- SC-002 schedule cutover cannot split an existing manual cycle.
- Minimal manager-only `settlement-cycle-lifecycle-panel.tsx`:
  manual date form, due refresh, OPEN/REVIEW cards with explicit “metadata
  only: no financial snapshot/transfer/offset” explanation.
- `SC-003-LIFECYCLE.md` describes all time/permission/retry constraints.

**Tests written**
- `settlement-cycle-lifecycle.integration.mjs`: PostgreSQL trigger,
  overlapping/adjacent periods, unique/FK/CHECK, audit immutability,
  review transition and zero writes to monetary tables.
- `preview-http.smoke.mjs`: unauthorized admin, manual duplicate key,
  owner/delegate simultaneous creation, early review, opt-in-before-start,
  disable, cron retry, delayed weekly catch-up, safe weekly->biweekly
  revision cutover, no historical backfill after late opt-in.
- The disposable integration workflow sets a **dummy CI-only**
  `CRON_SECRET` for HTTP bearer verification; no production secrets changed.

**Evidence available during implementation**
- Early full lifecycle code + HTTP integration succeeded on commit
  `52789c789fa6a048ff8c75de344dcb2a675e16e0`:
  https://github.com/mnhtng/group-expense/actions/runs/41861305883
  and https://github.com/mnhtng/group-expense/actions/runs/41861305803.
- SQL integration additionally succeeded on `88b045e2`:
  https://github.com/mnhtng/group-expense/actions/runs/41861006218.
- Final SC-003 code/documentation commit `e99ea906ecefc27d230f254698c215f5f9bfd3c5`:
  [CI passed](https://github.com/mnhtng/group-expense/actions/runs/41863083471),
  [PostgreSQL/HTTP passed](https://github.com/mnhtng/group-expense/actions/runs/41863083416).
  This gate was verified BEFORE starting SC-004.

**Release gate and outstanding work**
- No shared Neon migration, no staging/prod deploy, no merge into
  `develop`/`main`; PR #16 stays Draft.
- `SETTLEMENT_CYCLE_ENGINE_READY=false`. The only cycles are
  **time-window metadata** for already opted-in groups.
- All SC-003 final acceptance checks passed. SC-004 was started only after
  verifying both GitHub Actions runs above.

## 2026-11-04 — SC-004: DONE (feature branch; human review/release pending)

**One-ticket scope:** Canonical eligible-obligation snapshot and guarded
review -> locked transition. NO same-direction batch payment (SC-005),
no netting proposal or noncash set-off (BN-*), no future adjustment
execution (SC-006).

**Delivered**
- Migration `014_settlement_cycle_obligation_snapshots.sql`:
  source invoice rows (including self-only/no-obligation bills), one unique
  origin snapshot per obligation, immutable as-of cash fields,
  totals/versions, SHA-256 manifest, INSERT seal guards,
  money conservation CHECK, exact DB total/source validation.
  Cycle transition extended exactly from REVIEW v2 to LOCKED v3,
  contingent upon a correct complete manifest; no settlement transition.
- `lib/settlement-cycles/snapshot.ts`: canonical complete PostgreSQL SQL
  from active nonvoid obligations and nondeleted invoices within
  `occurred_on >= period_start AND < period_end`; excludes sources
  created after the lock cutoff; aggregates exact confirmed/pending
  settlement allocations; all calculations in bigint/numeric, no UI caps.
  Reads are independently recalculated under group+cycle locks.
- Explicit preview fingerprint binding: manager must preview exact totals,
  then POST lock with `expectedVersion=2`, UUID idempotency key and
  `expectedFingerprint`. Any live invoice/cash changes force HTTP 409
  and a new preview. Transaction also rereads persisted snapshot rows
  and asserts their fingerprint and totals before sealing.
- `GET/POST /api/groups/:groupId/settlement-cycle/cycles/:cycleId/snapshot`:
  authenticated, group member read, active owner/delegate only lock,
  default-OFF groups denied writes, snapshot lock does not perform
  money movement, discharges or invoice completion.
- `components/groups/settlement-snapshot-panel.tsx` and existing lifecycle
  panel: present confirmed/pending/outstanding/available separately;
  deliberate checkbox and explicit lock confirmation, no modal auto-close.
- `lib/expenses/service.ts` and DB triggers: frozen invoice cannot be
  changed/deleted or its item shares/obligations replaced; creator-only
  completion remains possible after ALL actual cash is confirmed with
  no pending claims. Historical snapshot remains unchanged after later cash.
- Read-only late bill count detects invoices absent from sealed source;
  late adjustment attribution belongs only to SC-006.
- `SC-004-SNAPSHOTS.md`: exact temporal and ledger contract.

**Final verified code SHA `f3fd73bdb7423ead4d89fa60882d7f5e84c6a784`**
- [CI (lint, typecheck, unit, Next.js build) — SUCCESS](https://github.com/mnhtng/group-expense/actions/runs/41871541097).
- [Disposable PostgreSQL 17 migration twice, integration and live HTTP — SUCCESS](https://github.com/mnhtng/group-expense/actions/runs/41871541730).
- `settlement-cycle-snapshot.integration.mjs`: direct DB checks for
  valid lock only with complete manifest, immutable source versions,
  zero destructive changes, created/confirmed payments after lock,
  frozen invoice creator completion only when paid.
- `preview-http.smoke.mjs`: **551** obligations across **551** invoices,
  confirmed and pending allocations, exclusive end-date and deleted
  invoices excluded, stale fingerprint after cash confirmation,
  two simultaneous owner/delegate locks ([200,409]), idempotent retry,
  late expense count after lock, old snapshot unchanged after new cash,
  creator-only invoice completion.
- Additional hardening: SQL prevents moving expense items/shares OUT
  of frozen invoices; group-disabled retry returns an already committed
  idempotent snapshot receipt but cannot start a new lock. Both behaviors
  are covered by the final green PostgreSQL/HTTP run.
- PostgreSQL tests used ephemeral GitHub Actions service; **no shared
  Neon development/production migration**.

**Unimplemented / intentionally deferred**
- Snapshot is an AS-OF baseline, not an authorization to pay that amount
  after later confirmations. SC-005 MUST re-evaluate the actual live
  available balance under locks before creating any settlement.
- Late bills are only detected, not moved/charged into another period:
  SC-006 adjustment design remains required. Full 10k+ stress/property
  testing is also part of SC-007; current HTTP coverage exceeds both
  legacy 100-invoice and 500-debt UI limits.
- No set-off, bilateral calculator, auto-lock or auto-payment in SC-004.
  `SETTLEMENT_CYCLE_ENGINE_READY=false` remains unmodified.
- Draft PR #16, no merge into `develop`/`main`, no staging/production
  deployment or shared Neon migration. Financial P0 release gate remains CLOSED.

## 2026-11-04 — SC-005: DONE (feature branch; no real-money rollout)

**One-ticket scope:** same-direction, single-pair, single locked-cycle cash
batch using original settlements/allocations and original two-party confirm.
No BN-* offset, no SC-006 adjustment attribution, no SC-008 full mobile UI.

**Delivered**
- `015_settlement_cycle_batch_repayments.sql`: immutable
  `group_settlement_cycle_repayments` provenance with composite group,
  cycle snapshot and cash-settlement FKs; DB verifies complete source
  allocation membership, exact row count, cash sum and pending status.
  Later direct SQL cannot edit/delete provenance, reassign batch allocation
  rows, alter original amount/counterparties or replay settlement events.
  Exactly the existing counterparties may confirm/reject/cancel.
- `lib/settlement-cycles/repayments.ts`: complete canonical snapshot
  source query (no 100/500 UI cap), validated live confirmed/pending
  allocations, precise BigInt VND sums; deterministic per-direction
  fingerprint includes original obligation ID/version and live remaining.
  The `POST` transaction locks group→cycle→sorted original obligations,
  rechecks current balances, rejects stale preview (409), inserts one
  `settlements` PENDING row, all allocations through typed UNNEST,
  immutable cycle provenance, existing settlement audit and notification.
  Existing legacy/manual payment path remains unchanged.
- Session-authenticated `GET/POST
  /api/groups/:groupId/settlement-cycle/cycles/:cycleId/repayments`:
  active group member can preview; only actual debtor/creditor may
  request. Both endpoints reject nonlocked or other-cycle scope;
  idempotent request key survives lost responses and opt-out; fresh
  requests after opt-out rejected.
- Existing `PATCH /api/groups/:groupId/settlements/:settlementId`
  remains the ONLY confirm/reject/cancel mechanism. New pending batch
  never counts as confirmed cash; neither owner nor cycle manager may
  confirm on someone else's behalf.
- **Production safety:** `SETTLEMENT_CYCLE_ENGINE_READY=false`
  unchanged. Only disposable PG17 GitHub CI may exercise this unreleased
  money code when `CI=true`, `SC005_TEST_ONLY=isolated-pg17`
  and DATABASE_URL equals the exact localhost fixture URL. Normal
  developer/Preview/staging/production requests fail closed (HTTP 409).
- `SC-005-BATCH-REPAYMENTS.md` documents the exact model and release gate.

**Test evidence (latest financial code/test commit `0322270f1cd464a104f8da4883bd913e42c7935f`)**
- [CI lint/typecheck/unit/build — SUCCESS](https://github.com/mnhtng/group-expense/actions/runs/41875114919)
- [Disposable PostgreSQL 17 migration twice + integration + HTTP — SUCCESS](https://github.com/mnhtng/group-expense/actions/runs/41875114912)
- HTTP test: 550 obligations from 550 snapshot sources in ONE PENDING
  cash request; a separate partial pending reservation makes previous
  fingerprint stale and reduces available cash by exactly 250 VND.
  Two different-key concurrent attempts yield [201,409], identical-key
  simultaneous retries [201,200], no double count. Wrong-cycle,
  reversed pair, nonparty admin, self confirmation, other unrelated
  approver, stale/unknown fields and changed note are denied.
  Original other party confirms all 550 allocations in ONE transition.
  A second rejected batch frees availability, new request covers exact
  residual, and *opposite initiator* requires confirmation by the debtor.
  Direct SQL tampering with allocations, batch metadata, settlement amount,
  event history and association with nonlocked cycle is rejected.
  Disabled group disallows new cash but still reads old idempotent receipt.
- All Postgres/HTTP tests use temporary GitHub Actions PG17, NOT shared
  Neon branches. No development/main branch change, no production data
  changes, no deployment. PR #16 remains Draft against `develop`.

**Deferred by contract**
- No noncash offset or multi-person debt simplification (BN-*).
- No late invoice reattribution (SC-006), no full mobile finance UI (SC-008)
  or final financial release gates (SC-007/SC-010).
- CI-only testing exception must never become a user-facing release switch;
  production finance remains OFF pending a separate audited rollout.

## NEXT CONVERSATION: BN-001 ONLY

**Ticket:** Pure BigInt calculator for STRICT pairwise bilateral offsets,
deterministic allocation and eligibility (only TWO persons, no third-party
simplification, no real set-off, no proposal persistence or financial ledger
mutation). Read all `docs/settlement-cycles/*.md` first. Work only on
`feat/settlement-cycles-bilateral`; maintain Draft PR, test before claiming
completion. No BN-002, SC-006 or deployment in this next conversation.
