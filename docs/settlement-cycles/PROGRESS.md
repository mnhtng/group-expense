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

## 2026-11-05 — BN-001: DONE (code and native CI + PostgreSQL/HTTP verified; release OFF)

**Ticket:** Pure two-member BigInt noncash offset calculator. STRICTLY
no proposal, approval, ledger, SQL migration, external API, UI or release
flag changes.

**Scope files:**
- `lib/settlement-cycles/bilateral-calculator.ts`: independently
  callable pure function, no imports, no IO/DB/clock/side effects.
  Requires EXACT two people, one group, one locked cycle, local
  `[periodStart,periodEnd)`, VND, original source ID/version and explicit
  same-cycle snapshot eligibility/active invoice/obligation flags.
  Checks valid integer minor amounts (PG bigint bound per source), tracks
  confirmed cash and confirmed setoff separately from pending cash and
  pending setoff reservations, rejects any invalid or third-person source.
  Computes `min(available_A_to_B,available_B_to_A)` exactly using
  BigInt and assigns equal hypothetical noncash amounts to both directions
  by stable local invoice date then source obligation UUID.
  Returned amounts are strings and never imply payment/approval.
- `tests/bilateral-calculator.test.mjs`: 16 test groups, tests
  for equal/unequal/zero directions, partial confirmed & pending balances,
  old reservations cancelled, reversed party labels, safe upper
  precision, exact local date boundaries and role/group/cycle/third-person
  rejection, immutable original input, deterministic per-source ordering,
  1,200 seeded property cases and 10,000 source rows.
- `docs/settlement-cycles/BN-001-CALCULATOR.md`: complete domain
  assumptions, exact conservation invariants and exclusions.
- `BACKLOG.md`: status remains pending until official CI acceptance.

**Final acceptance — commit `45279fa2182728857229813e90e7f2cb4a1657c3`:**
- [GitHub CI SUCCESS](https://github.com/mnhtng/group-expense/actions/runs/41938338962):
  lint, typecheck, **86 unit tests passed, 0 failed**, Next.js build.
- [GitHub PostgreSQL 17 + HTTP Integration SUCCESS](https://github.com/mnhtng/group-expense/actions/runs/41938338952):
  isolated DB migrations and full existing financial HTTP regression.
- `tests/bilateral-calculator.test.mjs`: 16 pure calculator scenarios,
  1,200 deterministic property cases, 10,000 original obligations.
- `tests/bilateral-calculator-experiment.test.mjs`: six dinner-related
  invoices in one weekly cycle. A->B: outstanding 240,000; pending
  35,000; available 205,000 VND. B->A: outstanding 220,000;
  pending 30,000; available 190,000 VND. Exact symmetrical
  hypothetical set-off: **190,000 VND per direction**.
  A->B allocations: 80k, 90k, 20k; B->A: 100k, 50k, 40k.
  Available residual A->B 15,000 VND, B->A 0.
  Input permutation does not change allocations; third-party,
  foreign-cycle, excessive pending and out-of-range invoice are denied.
- This is a READ-ONLY mathematical experiment; no actual cash or
  noncash discharge was posted, and no live user data was touched.
- Detailed result: `BN-001-EXPERIMENT.md`.

**Prohibitions and release gate:**
- No financial schema migration or any writes to original
  `obligations`, `expenses`, `settlements`,
  `settlement_allocations`, cycle snapshot or cash ledger.
- No proposals (BN-002), approval API (BN-003), ledger offset (BN-004),
  future cycle adjustments (SC-006) or payment/completion automation.
- `SETTLEMENT_CYCLE_ENGINE_READY=false`; `develop` and `main`
  untouched. No staging/prod deployment or shared Neon migrations.
- PR #16 remains DRAFT and never merged automatically.

## 2026-11-05 — BN-002: DONE (code and isolated PostgreSQL/HTTP verified; NO money rollout)

**One-ticket scope:** ONE canonical two-person/one-cycle VND proposal
HEAD, immutable per-version document with full original source proof,
live-ledger SHA-256 fingerprint, optimistic version and idempotency.
No proposal approval or noncash offset application.

**Implementation**
- `016_bilateral_proposal_documents.sql`: new heads, proposals and
  original-source proof tables only; no writes to existing financial
  ledgers. Composite snapshot FK and immutable proposal/source triggers;
  atomic head guard checks source count, current cash states, both
  directional sums, maximal offset and strict BN-001 FIFO allocation.
- `lib/settlement-cycles/proposals.ts`: read all exact original
  obligations from locked cycle snapshot + live cash ledger under
  repeatable-read preview and group-locked transaction for publication.
  Hash binds immutable snapshot, exact pair, all source IDs/versions,
  confirmed/pending cash and proposed FIFO allocations, INCLUDING
  fully paid zero-available sources. A creator-only completed invoice
  does not invalidate its unchanged original financial source version.
- `GET/POST .../settlement-cycle/cycles/:cycleId/bilateral-proposals`:
  anonymous 401; only actual two active participants may preview/create,
  no manager/admin impersonation. Requires both explicit feature opt-ins
  and locked snapshot for writes. New document only when expected pair
  version and exact live fingerprint match. Repeated same request key
  returns original document, even if pair head later advances/opt-out.
  All outputs state `approvalEnabled:false`,
  `financialEngineEnabled:false`.
- Earlier document versions remain immutable and head version advances
  one step at a time; there is no mutable approval or reservation status.
- Detailed contract: `BN-002-PROPOSALS.md`.

**Final acceptance evidence: source code commit
`3fdc257173217a6eed68414261c2c38c3d92bce4`**
- [GitHub CI — SUCCESS](https://github.com/mnhtng/group-expense/actions/runs/41944569337):
  lint, typecheck, native unit tests, Next.js build.
- [PostgreSQL 17 + HTTP integration — SUCCESS](https://github.com/mnhtng/group-expense/actions/runs/41944569536):
  all migrations twice/checksum, SQL regression, real authenticated HTTP.
- Reproducible HTTP fixture tests 122 source obligations and 61 positive
  allocations in EACH direction, plus pending cash. Two different
  request keys published concurrently [201,409], identical keys
  concurrently [200,201] with matching IDs. Old fingerprint after
  confirmed cash fails 409; immutable version 1 remains while a new
  version 2 publishes; all proposal writes leave settlements and
  settlement_allocations unchanged.
- Negative DB check directly writes equal directional totals with
  FALSE FIFO allocation; head publication rejected and entire
  transaction rolled back. Frozen original invoices can still be
  creator-completed after full cash confirmation; proposal fingerprint
  correctly ignores only that nonfinancial version bump.
- No shared Neon/staging/production migration; no merge into
  `develop`/`main`; PR #16 stays Draft.

**Release safety:** `SETTLEMENT_CYCLE_ENGINE_READY=false`. Proposal
metadata may be authored by two participants only after deliberate
opt-in, but does NOT reserve, pay or discharge one dong. Subsequent
BN-003/BN-004 MUST revalidate the live ledger and immutably hashed
document before any approvals or noncash application.

## 2026-11-05 — BN-003: DONE (only signed decisions; ledger remains untouched)

**Scope:** Independent two-party consent to immutable BN-002 proposal
versions, rejection, revocation, expiry and durable invalidation when
money or eligibility changes. No automated monetary set-off or
reservations, and no changes to the existing cash payment pipeline.

**Implementation:**
- `017_bilateral_decision_events.sql`: append-only
  `group_settlement_bilateral_decision_events`; exact proposal/pair
  and fingerprint foreign keys; actor-specific approval identity,
  at-most-once per signer and at-most-one terminal event; row locks
  protect concurrent SQL decision writers.
- Automatic, transactional invalidation on original settlement
  allocation/cash status changes, pair-member departure, group
  archive and group-level opt-out. Subsequent cash cancellation,
  member rejoin or opt-in cannot revive a terminal signature.
- `lib/settlement-cycles/decisions.ts` and authenticated
  `GET/POST .../bilateral-proposals/:proposalId/decisions`:
  active pair-only reads and decisions; `approve`, `reject`,
  `revoke` with immutable request-key/idempotency, expected version
  and exact original source fingerprint. Two separate approvals produce
  `agreed` ONLY; always `readyForApplication:false`.
- Expiry is 72 hours; GET projects time-dependent state read-only.
  A late attempted decision commits one system `expired` event
  before returning 409. A stale state does likewise for
  `invalidated` when not already recorded.
- SQL hardening on final commit: `reject` and `revoke` cannot
  be forged through direct SQL after 72-hour expiry or while
  pair eligibility/cash state is stale. Negative integration tests
  confirm no extra audit/event rows survive those attempts.
- Contract: `BN-003-DECISIONS.md` documents the full state machine.

**Verified source HEAD `6cdd80fa3aa11fd0432d2847c5714dbd46c982e1`:**
- [GitHub CI SUCCESS](https://github.com/mnhtng/group-expense/actions/runs/41962695419):
  lint, TypeScript, Node unit suite, Next.js production build.
- [Disposable PostgreSQL 17 / HTTP SUCCESS](https://github.com/mnhtng/group-expense/actions/runs/41962695398):
  migration replay, DB integrity integration, authenticated HTTP
  approval/rejection/revocation/expiry/invalidation and races.
- Test reuses a 122-obligation, two-counterparty original pair.
  Same-key racing approval returns [201,200] with identical event;
  two different signatories are required for `agreed`.
  Approval-vs-rejection is serialized; terminal revocation survives,
  old proposal signatures cannot leak into newer revisions.
  Pending cash and later cancellation do not resurrect stale consent.
  Opt-out/re-enable, member leave/rejoin and archive invalidate
  only relevant current pair; unrelated third member leaving does not.
  Forged SQL late reject/revoke after expiry is rejected.
- No new noncash monetary tables, no offset application, no
  `settlements` or `obligations` mutations by decision APIs.

**Release gate remains CLOSED:** `SETTLEMENT_CYCLE_ENGINE_READY=false`.
Draft PR #16 targets `develop`; no merge, shared Neon migration or
staging/production deployment. Actual bilateral noncash ledger
application is **BN-004, a separate future ticket only**.

## 2026-11-05 — BN-004: DONE (isolated atomic noncash proof; NOT released)

**Ticket boundary:** applies only a two-sided, previously agreed,
immutable BN-002 proposal. Adds a NEW append-only noncash application
and exact original-obligation allocations; DOES NOT write to existing
cash ledger/settlements, modify source obligations, complete invoices or
integrate `confirmed_setoff` into debt readers (BN-005).

**Implementation:**
- `018_bilateral_noncash_applications.sql`: pair-cycle uniqueness,
  per-obligation uniqueness, immutable application and allocations,
  direct SQL two-signature/expiry/stale-money checks, proposal-row lock
  against concurrent BN-003 revocation, deferred full two-direction
  conservation at transaction commit and denial of late revoke.
- `lib/settlement-cycles/applications.ts`: group→cycle→proposal head
  →original obligation locks, source SHA recomputation, exact BigInt
  amount and FIFO proof, one valid application with idempotent
  same-key recovery and conflict resolution.
- Authenticated `GET/POST .../bilateral-proposals/:proposalId/applications`;
  only actual pair members may apply/read. The audit clearly states
  `noncash:true`, `cashTransferredMinor:"0"`.
- BN-003 service additionally denies late revoke/reject for an already
  applied proposal, preserving the irrevocable transaction.
- Test-only financial gate is triple-bound to disposable GitHub
  runner `CI=true`, `BN004_TEST_ONLY=isolated-pg17`,
  `DATABASE_URL=postgresql://test:test@localhost:5432/group_expense`.
  Global `SETTLEMENT_CYCLE_ENGINE_READY=false` unchanged.
- Detailed contract `BN-004-NONCASH-APPLICATIONS.md`.

**Verified acceptance:** last pre-document hardening commit
`2cccecee1f403c1a3c27d125195304b7772cfd98`:
[CI SUCCESS](https://github.com/mnhtng/group-expense/actions/runs/41968439116),
[PostgreSQL 17 + HTTP SUCCESS](https://github.com/mnhtng/group-expense/actions/runs/41968439155).
The actual HTTP fixture uses 122 original BN-002 sources and two
independent BN-003 signers. Includes missing/one signature denial,
unrelated member/admin denial, version/fingerprint mismatches,
same-key concurrent [200,201], conflicting reapplication, direct SQL
one-sided rollback, equal two-way amounts, original source proof,
immutable audit and no cash allocation changes. Final docs/unit
verification also runs on the resulting HEAD.

**Intentionally not included:** no persistent pending setoff
reservation: one transaction locks both sides and commits the complete
noncash document or nothing. No `confirmed_setoff` read integration
yet; BN-005 must implement that with its own tests before any release.
No shared Neon DB, staging/production deployment, merge to
`develop` or `main`. PR #16 remains Draft.

## 2026-11-05 — BN-005: DONE (live balance integration; financial release still OFF)

**Only BN-005:** Integrate previously committed BN-004 noncash application
allocations into ALL outstanding, available, report, exit/archive,
creator-only invoice completion, ordinary cash and cycle-batch preview
decisions. No new settlement/offset write outside existing BN-004.
Global `SETTLEMENT_CYCLE_ENGINE_READY=false` remains unchanged.

**Changes**
- `019_bilateral_setoff_balance_integration.sql`: a live unmaterialized
  `bn005_obligation_balances` view; `original - confirmed_cash -
  confirmed_setoff`; `available=outstanding-pending_cash`.
  Deferred SQL guards reject cash/no-cash overbooking and the existing
  frozen-invoice creator-only trigger uses setoff-aware remaining amounts.
- `lib/debts/service.ts`: original debt and group/personal reports,
  source-traceable noncash audit and uncapped group total query.
- `lib/settlements/service.ts` and
  `lib/settlement-cycles/repayments.ts`: manual/batched cash never
  reserves an amount previously discharged by noncash setoff.
- `lib/settlement-cycles/proposals.ts`: live fingerprint includes
  applied original-source noncash; re-proposal for the same already
  discharged original pair+cycle returns conflict.
- `lib/expenses/service.ts`: readiness/progress/creator completion
  and debt-amount ranking recognize confirmed noncash while requiring
  zero unresolved pending cash and valid original source balances.
- `lib/groups/membership.ts` and `lib/groups/service.ts`:
  exact live outstanding for group leave/archive; corrupt balances
  fail closed, not zero-clamped.
- Debt/invoice summaries disclose separately confirmed cash vs noncash
  and do not represent a setoff as a bank transfer.
- `tests/preview-http.smoke.mjs`: actual PostgreSQL 17 + Better Auth
  HTTP fixture checks 122 ORIGINAL obligations, original bilateral
  netting conservation, group and personal reports, setoff provenance,
  creator-only close, member leave/archival restrictions, one-direction
  cash batch preview, manual cash overdraw and direct SQL rollback,
  noncash history immutability and pending/cancel/confirm residual
  states. Previous SC-001…BN-004 tests remain intact.

**Verified source commit `2d2cd9011af9958e7384c80eeb0bf2a78d845485`:**
- [CI SUCCESS](https://github.com/mnhtng/group-expense/actions/runs/41973907754):
  lint, TypeScript, native unit tests and Next.js production build.
- [Isolated PostgreSQL 17 + HTTP SUCCESS](https://github.com/mnhtng/group-expense/actions/runs/41973907437):
  migration 019 installed twice, SQL integration + authenticated
  HTTP money/permission/concurrency regression, exact double-spend denial.
- Detailed [BN-005-BALANCE-INTEGRATION.md](./BN-005-BALANCE-INTEGRATION.md).

**Release hold remains in force:** BN-004 test write requires strict
`CI=true` + `BN004_TEST_ONLY=isolated-pg17` + exact disposable
PostgreSQL localhost URL. No shared Neon DB migration or staging,
production, merge to `develop`/`main`. PR #16 stays Draft.

**Explicitly NOT included:** BN-006 net-residual cash orchestration,
SC-006 late-source/leave-invoice lifecycle enhancements,
SC-008 full mobile UI, notifications or settlement cycle completion.
The existing settlement cash flow is tested for compatibility only.

## 2026-11-05 — BN-006 DONE, safe by default (NO real financial release)

**Ticket boundary:** the original two real people may explicitly request
payment of ONLY the live post-BN-004/BN-005 cash residual on the
ORIGINAL locked-cycle obligations. BN-004 noncash proof and BN-005
balances remain independent. No synthetic cash, no auto-confirm.

**Source files:**
- `020_bilateral_residual_cash_repayments.sql`: immutable provenance
  binding original SC-005 ordinary cash settlement to the already
  APPLIED BN-004 noncash application. SQL checks exact live remaining
  amount, one original debtor→creditor direction, zero opposite
  outstanding, no older pending cash, all original source allocations
  and active pair/snapshot. No updates/deletes of audit records.
- `lib/settlement-cycles/residual-repayments.ts`: full original-source
  fingerprint and BigInt validation, group→cycle→obligation row locks,
  actor authorization and immutable request digest idempotency; exact
  one-transaction insertion of pending cash settlement, source
  allocations, SC-005 and BN-006 provenance, existing event and
  in-app notification.
- Authenticated `GET/POST .../cycles/:cycleId/bilateral-applications/:applicationId/residual`.
  POST requires expectedCycleVersion=3, SHA fingerprint, UUID request
  key and optional financial note; never client-supplied cash amount,
  receiver, debtor, source allocations or payment confirmation.
- Existing `PATCH /settlements/:id` is unchanged and alone supports
  real other-counterparty confirm/reject or initiator cancel.
- New `tests/bilateral-residual-contract.test.mjs` enforces release
  gate, no synthetic transfers and SQL original-source conservation.
- `tests/preview-http.smoke.mjs`: the same 122-obligation fixture
  covers unauthorized outsider/admin, no applied proposal, stale
  money, old pending cash blocking, explicit cancel/reject,
  same-key concurrent requests [200,201], cash pending not paid,
  failed initiator self-confirm, immutable source + provenance,
  counterpart confirmed residual zero, no additional zero transfer.
- `.github/workflows/sprint1-integration.yml`: BN006_TEST_ONLY
  flag exists only with PostgreSQL 17 disposable GitHub runner
  alongside exact DB URL and CI=true. The engine remains disabled.

**Verification at implementation SHA `0a63adb32ef10ec1ed218ac3abb2cd9dbf7e1834`:**
- [CI SUCCESS](https://github.com/mnhtng/group-expense/actions/runs/41977899879)
  includes lint, TypeScript, native unit tests, production build.
- [PostgreSQL 17 + authenticated HTTP SUCCESS](https://github.com/mnhtng/group-expense/actions/runs/41977899998)
  includes migration 020 twice, all SQL integration and HTTP
  payment/permissions/concurrency test suite.
- [BN-006-RESIDUAL-CASH.md](./BN-006-RESIDUAL-CASH.md):
  source-of-truth and release-gate contract.

**Explicit hold:** PR #16 stays Draft/open, base develop, no merge.
No shared Neon migration, no staging/production deploy and
`SETTLEMENT_CYCLE_ENGINE_READY=false` unchanged. Real financial
execution remains CI-only with all `CI=true`,
`BN006_TEST_ONLY=isolated-pg17`,
`DATABASE_URL=postgresql://test:test@localhost:5432/group_expense`.
Do NOT implement SC-006 without separate user request.

## 2026-11-05 — SC-006 DONE on feature branch, NOT released

**Scope:** immutable late original invoice attribution and exact
recurring/cycle ordering, creator-only membership exit responsibility
and group archival gates. No historical snapshot unlocking and no
financial ledger rewrite, original obligation duplication or
third-party debt simplification.

**Implementation**
- `021_settlement_cycle_late_adjustments.sql` adds unique immutable
  original invoice attribution linking one LOCKED original historical
  cycle to the chronologically first subsequent eligible REVIEW cycle,
  original invoice version, manager actor, per-manager idempotent key
  and note. PostgreSQL independently denies wrong group/role, wrong
  period, old snapshot source or edited invoice, sealed/invalid target,
  double assignment and mutation of audit. SQL frozen expense,
  item/share and obligation guards cover attributed sources immediately.
- Original SC-004 snapshot preview/insert and SQL REVIEW→LOCKED
  completeness guard now admit a historical date only when the
  immutable original invoice has explicit target assignment. Prior
  LOCKED snapshot AS-OF remains unchanged, new snapshot includes the
  ORIGINAL obligation IDs only once, and stale preview hashes deny lock.
- `lib/settlement-cycles/adjustments.ts` and authenticated
  `GET/POST .../cycles/:originCycleId/late-adjustments` support
  audit listing, recorded source recurring `ruleId/period`,
  earliest target suggestion and authorized owner/delegate posting,
  with same-key idempotent retry, source version check and no
  client-supplied monetary allocations. Creator-only edit/delete
  service returns controlled 409 on assigned historical source.
- The existing daily Vercel cron now finishes recurring catch-up
  BEFORE cycle metadata processing. Any recurring error or
  max-20 batch reached defers cycle metadata safely; the existing
  UNIQUE(rule_id,period) still forbids duplicate recurring invoice.
- Membership leave/removal blocks the original creator with any
  uncompleted frozen/attributed/late invoice even after the original
  debt is zero. A successful member departure atomically PAUSES
  active recurring templates involving that member (creator, payer
  or split participant) and revokes cycle-manager delegation.
  The member UI renders the independent creator confirmation reason.
- Group archiving refuses OPEN/REVIEW cycle, unresolved original
  frozen debt/pending, uncompleted frozen source invoice and
  unassigned late original historical invoices, while allowing an
  otherwise fully resolved immutable LOCKED period to be archived.

**Acceptance:** Real disposable PostgreSQL 17 migrates schema
001–021 twice with SHA verification. Authenticated HTTP fixture
creates a locked origin, late original invoice, adjacent REVIEW
cycle, concurrently idempotent manager assignment, denied unrelated
admin/creator/forged amounts, immutable pre-seal original,
fingerprint invalidation, and later sealed snapshot with exactly ONE
original invoice/obligation. A separate zero-debt self-paid invoice
fixture proves creator-only finalization before leaving, successful
departure pauses a monthly template and permits archive when all
sources resolved. Unit contract tests cover SQL/manager/cron scope.
Existing SC-001…BN-006 cash and NONCASH tests unchanged.

**Verified at code commit `b235e2b743f5a6c9b110744e3ca02be122a04909`:**
- [CI SUCCESS](https://github.com/mnhtng/group-expense/actions/runs/41984321612)
- [PostgreSQL17/HTTP SUCCESS](https://github.com/mnhtng/group-expense/actions/runs/41984321562)
- [SC-006 contract](./SC-006-LIFECYCLE-ADJUSTMENTS.md).

**Safety:** `SETTLEMENT_CYCLE_ENGINE_READY=false` unchanged,
Neon shared branches not migrated, no Vercel deploy, no production
money movement or PR merge. PR #16 remains **DRAFT**.

**Known scope limit:** No direct compensation/refund amount for a
previously PAID frozen invoice. Such a disputed original needs a
separately audited future monetary-adjustment ticket; SC-006 only
permits a previously UNRECORDED late original invoice to be
attributed for subsequent settlement. No SC-007 release gate,
SC-008 mobile UI or SC-009 notifications implemented here.

## NEXT CONVERSATION: SC-007 ONLY

Implement comprehensive financial concurrency, permission,
property-based and E2E regression tests, including explicit
release-readiness review. Do not enable financial engine, merge,
migrate shared Neon, or deploy staging/production without a separate
explicit release decision. Keep PR #16 Draft.

