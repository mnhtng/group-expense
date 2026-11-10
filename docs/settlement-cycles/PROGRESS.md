# Delivery ledger — implementation and readiness evidence

## 2026-11-10 — SC-025 activation continuation (local implementation)

Current branch `feat/settlement-cycle-activation` starts from main PR20 and
preserves the PWA install banner. Operator-only policy replaces the literal-OFF
gate, default OFF with no admitted groups, caps1/5/25, immutable operator audit
and transaction-serialized pause. Real financial paths require explicit group
opt-in and retain two-party authorization, idempotency and SQL conservation.

[Implementation and final verification](SC-025-CONTROLLED-ACTIVATION.md);
[concrete managed execution scope](../release-readiness/SC-025-MANAGED-EXECUTION.md).
No managed025, hosted positive financial test or real-group activation has
occurred in this continuation. Email remains deferred. The baseline and dated
entries below are historical; later release receipts supersede their old
no-deployment statements.

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

## 2026-11-05 — SC-007 DONE in isolation, RELEASE NO-GO

Only SC-007: comprehensive financial, authorization, concurrency,
property-based, direct SQL and authenticated Next.js/Better Auth/
PostgreSQL HTTP E2E regression. No new feature or financial write.
Never merge or activate the actual financial engine from this result.

**New verification infrastructure**
- `tests/sc007-financial-properties.test.mjs`: 1,500 reproducible
  seeded randomized BigInt source ledgers, independent expected
  two-way offset, pending conservation, bidirectional equality,
  FIFO, pair-swap/permutation invariance; 10,000 ORIGINAL sources
  with >50 allocations/direction; invalid money/currency/party/
  group/cycle/source/version fail-closed.
- `tests/sc007-financial-concurrency.integration.mjs`: 16
  simultaneous TWO POSTGRES TRANSACTION races each allocating
  7,000+7,000 into an ORIGINAL 10,000-VND debt. Exactly ONE
  COMMIT each time, 16 rolled-back losers and exact 7,000 pending /
  3,000 available live debt; rogue cross-group allocation and
  extra 3,001 pending cash fail and leave ledger unchanged.
  A losing direct SQL writer can fail with `40P01` deadlock or
  BN-005 capacity guard. Both are safe rollbacks; HTTP original
  financial writers already use the deterministic group lock.
- `db/sc007-audit.mjs`: SQL-only INDEPENDENT REPEATABLE READ
  READ ONLY reconciliation with exact disposable CI PG17 triple
  guard (CI, SC007_TEST_ONLY, exact local DB URL). Eight
  cross-table checks: original obligations vs confirmed/pending
  real cash and applied noncash; per-settlement allocation sums;
  BN-004 opposite-direction conservation and original-source
  links; BN-006 cash provenance; SC-006 historic original
  attribution; one snapshot origin per source; unique monthly
  recurring occurrence. CI performs audit BEFORE and AFTER
  authenticated HTTP E2E. No data mutation.
- `tests/sc007-release-safety.test.mjs` guards hardcoded
  `SETTLEMENT_CYCLE_ENGINE_READY=false`, CI-only exact localhost
  gates for SC-005/BN-004/BN-006, no synthetic confirmation
  and trusted PostgreSQL proof for historical late invoices.
- Existing 550+ cash allocations, 122 two-sided original
  noncash obligations, manager/role/owner revocation,
  approval/expiry/revoke, pending/reject/confirm, idempotent
  concurrent 200/201, invoice creator completion, group
  leave/archive and month scheduling E2E continue to pass.

**Bug discovered by release regression and FIXED**
- SC-006 audited late original invoices appear in a later LOCKED
  snapshot, but BN-001 previously rejected a historical
  occurredOn outside the target period. The proposal service
  now independently proves `group_settlement_cycle_adjustments`
  for exactly source expense/cycle/version. Only then does the
  calculator allow the ORIGINAL (unchanged) late date, while
  all group/pair/version/locked-source and FIFO checks remain.
- Positive and negative seed-unit properties plus a real
  SC-006->BN-002 authenticated HTTP preview prove correct
  eligibility and exact 3,000-VND preview without writing money.

**Verified at implementation SHA `e8f0d534b8bc592079d9d3bb88b24256f82e2a27`:**
- [CI Success](https://github.com/mnhtng/group-expense/actions/runs/41995965007):
  all lint, TypeScript, deterministic unit/property and build.
- [Disposable PostgreSQL 17 / HTTP / pre- and post-audit Success](https://github.com/mnhtng/group-expense/actions/runs/41995965095):
  migration 001–021 twice, real concurrent SQL, full SQL and
  HTTP E2E, independent ledger reconciliation.
- After E2E: **704 obligations, 40 cash settlement records,
  1 applied noncash document, 676 frozen obligation sources,
  1 original late invoice attribution**. Eight read-only
  reconciliation checks, zero mismatches.
- [SC-007-RELEASE-SAFETY.md](./SC-007-RELEASE-SAFETY.md):
  acceptance matrix and conservative release prerequisites.

**Release decision: NO-GO.** This P0 financial test suite is
complete only on disposable PostgreSQL 17, NOT on a separate
Neon test branch or any real infrastructure. SC-008 product mobile
UI, SC-009 notification/dispute/audit UX, SC-010 operational
backup/monitoring/rehearsal/staged rollout and controlled real
environment reconciliation have not been completed. No
browser-device E2E of the future SC-008 UI exists in SC-007.
Never set `SETTLEMENT_CYCLE_ENGINE_READY=true` from a passing
CI, or migrate shared Neon, enable production cash, deploy,
merge PR #16 or treat test-only flags as product configuration.

## 2026-11-05 — SC-008 DONE on feature branch; finance release NO-GO

**Only SC-008:** mobile-first member-visible, permission-aware UI
for group settlement cycles, original ledger source drill-down,
two-person bilateral approval and noncash/cash distinction,
SC-006 immutable late source management, existing invoice
creator-only completion navigation and accessibility. No new
financial ledger, migration or bank transfer.

**User journeys implemented**
- Group screen links to `/groups/:groupId/cycles`: historical
  authorized 50-per-page cycle list, correct date/timezone,
  manager settings entry and OPEN/REVIEW/LOCKED states.
  `/groups/:groupId/cycles/:cycleId` now directly loads an
  authorized period by group+ID regardless of age, avoiding
  newest-100 truncation. Both pages verify signed account
  and CURRENT active group membership before querying data.
- OPEN shows existing original group invoices; REVIEW reuses
  the SC-004 source fingerprint and existing manager-only
  snapshot approval; LOCKED shows the ORIGINAL frozen
  source names/dates/IDs, total live BN-005 balances,
  an original-bill link and historical snapshot separately.
- `lib/settlement-cycles/ui-read.ts`: PostgreSQL
  REPEATABLE READ READ ONLY, active group/cycle checks,
  full-source `numeric`/BigInt original debt, confirmed
  CASH, confirmed NONCASH, pending CASH, remaining/available,
  fail-closed financial conservation; 50-item UI source
  paging does NOT truncate money totals.
- `settlement-cycle-finance-panel.tsx`: exact two-person
  dropdown, two-sided BN-002 offset calculation, FIFO
  original-obligation preview, BN-003 actor-specific
  approval/reject/revoke/expiry status, BN-004 immutable
  noncash document (NOT bank transfer), BN-006 one-way
  residual cash request states, SC-005 one-way cash preview.
  Financial writing buttons are hard disabled by the
  original `SETTLEMENT_CYCLE_ENGINE_READY=false` gate.
  An optional future release cannot be enabled just by
  local JS state or owner/admin status.
- `settlement-late-invoice-panel.tsx`: owner/delegated
  manager-only review of original missed expenses, recurring
  source provenance, next eligible REVIEW period, two-step
  inline idempotent assignment. Creator-only invoice close
  still uses the existing protected original invoice page.
- Mobile-first responsive cards, 44–48px tap targets,
  Vietnamese status and financial category labels,
  keyboard-select labels, controlled persistent source
  disclosure, inline consent/retry and visible loading/
  error/disabled states. No `<details>` auto-close modal
  or `window.confirm` interaction.
- `tests/sc008-cycle-ui.test.mjs`: route/member, historic
  paging, BigInt unpaginated money, pair/role/consent,
  late-source and engine-locked controls.
- `tests/preview-http.smoke.mjs`: authenticated Next.js
  server-rendered pages with real Better Auth and PG17:
  anonymous cycle navigation denied, 122 ORIGINAL
  obligations (>50 visible rows), unchanged total on
  source page 2, exact confirmed CASH vs applied
  NONCASH vs pending CASH display, active user
  permissions and original late-attributed invoice
  visible in the later LOCKED snapshot.

**Verified implementation SHA `932f47dd5c05bb58cc8943750c799db115d70e59`:**
- [CI SUCCESS](https://github.com/mnhtng/group-expense/actions/runs/42009125034):
  lint, TypeScript, all native unit/UI contract tests, Next.js build.
- [PG17 + HTTP + financial pre/post audit SUCCESS](https://github.com/mnhtng/group-expense/actions/runs/42009124994):
  migrations twice, SQL/property/concurrency tests,
  original source UI + real authentication and balance
  reconciliation all green.
- [SC-008-MOBILE-UI.md](./SC-008-MOBILE-UI.md) covers page,
  status, source and test contracts.

**Not claimed:** No installed iOS/Android PWA device visual
regression, Playwright pointer/touch/focus full UI E2E,
isolated shared Neon rehearsal, SC-009 notification/dispute/
audit UI or SC-010 operational release. Test coverage
is actual authenticated SSR/HTTP + code UI contract;
it is NOT the same as full browser mobile automation.

**Release:** NO-GO; `SETTLEMENT_CYCLE_ENGINE_READY=false`
untouched, PR #16 remains Draft/open/unmerged against
`develop`. No shared Neon migrations and no Vercel
staging/production deployments.

## 2026-11-05 — SC-009 DONE on isolated feature branch (release NO-GO)

**Scope only SC-009:** in-app notifications and overdue reminders,
actual two-person disputes, manager late-invoice follow-up,
source-immutable chronological audit, original-ledger CSV export
and full live debt reconciliation. No new money entry, ledger
discharge, fake bank transfer, invoice/snapshot modification
or automatic cycle completion.

**Implementation**
- `022_settlement_cycle_notifications_disputes.sql`: compatible
  extension of existing cash notification schema, nullable
  system actor, scoped original cycle+group FK and unique
  recipient/event-key idempotency. Immutable event triggers
  emit pair-specific proposal/decision/NONCASH notices,
  review/snapshot lock notice, SC-006 actual late-invoice
  attribution notice, pair-dispute lifecycle notices.
  Original settlement notification history stays unchanged,
  push preferences and queued delivery are reused.
- Original locked-cycle obligation dispute has immutable
  `group_settlement_cycle_disputes` and append-only
  `group_settlement_cycle_dispute_events`. Signed real
  counterparty only; `respond` from counterpart,
  `resolve`/ `withdraw` only from reporter. Idempotent
  per actor/request key; no owner/admin impersonation.
  SQL direct writes cannot UPDATE/DELETE documents.
  Only real pair can read private correspondence, including
  in audit/CSV. A 3rd-party group admin receives NO
  pair-specific dispute contents.
- OPEN/awaiting original dispute blocks both new original
  manual CASH allocations and SC-005 batch CASH against
  affected original, BN-004 NONCASH application and
  confirmation of pre-existing original pending CASH.
  It does not auto-cancel or rewrite settled money.
  SC-005 returns a controlled HTTP 409, not SQL 500.
- `lib/settlement-cycles/disputes.ts`: active group
  lock, exact original pair and locked cycle checks,
  optimistic source safety, original event reuse, repeat
  200 vs fresh 201 and conflict 409; immutable history.
  Two signed HTTP routes implement list/open/respond/
  resolve/withdraw. No client actorId/amount/status.
- `lib/settlement-cycles/reconciliation.ts`: source
  exact BN-005 cash, noncash, pending, remaining
  conservation under repeatable-read read-only SQL;
  incomplete creator invoice, current live unresolved
  proposal, disputed source and pending original CASH
  counters; readiness is informational only.
  Chronological audit combines existing immutable
  financial and cycle sources, with original IDs
  and pair privacy, 50-event page, 20k CSV ceiling
  (refuse, never silently truncate).
- `components/groups/settlement-cycle-ops-panel.tsx`
  is a mobile-first detail panel with human readable
  live report, external CSV downloads, private
  original-source dispute selector, inline consent,
  counterpart responses and historical events.
  Existing cash/nonce workbench and creator-only
  invoice completion remain unchanged.
- `lib/settlement-cycles/reminders.ts` and existing
  authenticated Cron reuse original push queue;
  bounded 40 daily event/recipient idempotent reminders
  for review/approval/pending CASH/late original/
  dispute. New reminders remain disabled on real
  environments while financial release is OFF.
  CI-only gate requires EXACT `CI=true` +
  `SC009_TEST_ONLY=isolated-pg17` + disposable
  PostgreSQL localhost URL.

**Verification source SHA `fad9d53a8ad508d4ffff20321276f9a2827a4bde`:**
- [CI Success](https://github.com/mnhtng/group-expense/actions/runs/42021023429):
  lint, TypeScript, unit + UI contract, production build.
- [Disposable PostgreSQL 17 / authenticated HTTP Success](https://github.com/mnhtng/group-expense/actions/runs/42021023156):
  migration 001–022 installed twice; full financial SQL,
  native tests, 16 concurrent cash races, BN-004 pair
  conservation, before/after independent financial audit.
  Real signed flow: opens one pair-private original dispute
  and notification, rejects admin/third party and fake
  actor/changed key, original pending CASH cannot be
  confirmed, new manual or cycle CASH allocation cannot
  be created against active dispute, immutable note audit,
  original counterpart responds, original reporter resolves,
  source money unchanged. JSON and CSV export enforce
  membership and private pair history. Event-key
  notification idempotency checked under concurrent
  direct PostgreSQL calls.
- [SC-009 canonical document](./SC-009-NOTIFICATIONS-DISPUTES-RECONCILIATION.md)
  describes source identities, endpoints, security,
  CSV/notifications/reminder policy, testing and
  release limits.

**Explicit release hold:** `SETTLEMENT_CYCLE_ENGINE_READY=false`
unchanged. No shared Neon branch migration, no
staging/production deploy, no merge to develop/main.
PR #16 open Draft targeting develop. This is
CI + PostgreSQL/HTTP verification, not physical
browser/iOS/Android E2E or real platform release.
No SC-010 operational runbook/recovery plan implemented
in this conversation.

## 2026-11-05 — SC-010 operational implementation DONE; financial RELEASE NO-GO

**One ticket only:** operational runbooks, bounded/fair
recurring and cycle catch-up, durable redacted Cron audit,
single-flight manual replay, private health and alerts,
PostgreSQL 17 backup/restore with independent immutable
ledger hashes, isolated Neon branch preflight and
controlled staged-rollout design. No ledger/CASH/NONCASH
release work, no third-party netting and no automatic
cycle completion.

**Code and operational effects**
- `023_settlement_cycle_operational_runs.sql` adds
  append-only terminal Cron run records and fair
  `recurring_cron_checkpoints`. Run can change
  from `running` to success/partial/failed only once;
  interrupted runs are detectable. Finance sources
  are unchanged.
- `lib/settlement-cycles/ops-runner.ts` uses a
  session-level `pg_try_advisory_lock(230010,2026)`
  to prevent concurrent Cron/authorized manual replays;
  second worker returns 202 without a duplicate run.
  The existing daily Vercel Cron remains one schedule
  at 02:00 UTC; signed POST with whitelisted
  `x-ops-replay-reason` reuses same idempotent pipeline.
- Recurring template scan rotates fairly across
  active rule checkpoints, uses 201st sentinel
  for 200 rules, bulk checkpoint update, never
  silently starves rule 201+. If invoices
  generated hit cap, have source errors, or a
  rule scan is incomplete, cycle metadata defers.
  Group metadata Cron checks 31st candidate and
  24-period per-group capacity. All caps/deferred
  states return 503 partial rather than
  claiming full completion.
- Read-only `GET /api/internal/settlement-ops/status`
  requires `CRON_SECRET` Bearer, reports aggregate
  health, missing/stale runs, stuck >25m,
  recent recurring/group checkpoint errors,
  dead/pending push jobs and human-review
  backlog. No group IDs, invoice text, names,
  credentials or payment counterparties in
  operational telemetry.
- Original source-sensitive mutations remain
  controlled by SC-001…SC-009. No change to
  `SETTLEMENT_CYCLE_ENGINE_READY=false`.
  No further release flag, financial write API
  or unapproved feature activation.
- New `scripts/sc010-restore-drill.sh`
  runs a PostgreSQL 17 `pg_dump` and
  `pg_restore` into a distinct CI-only
  `group_expense_sc010_restore` database,
  with exact localhost/CI flags; no shared
  DB URL accepted, temporary dump deleted.
  `db/sc010-restore-verify.mjs` compares
  exact SHA-256 hashes/counts of ORIGINAL
  obligations, invoices, cash settlements/
  allocations, BN-004 application sources,
  locked snapshots, SC-006 late source,
  SC-009 disputes, notifications, Cron
  records, fair recurring checkpoints,
  BN-005 canonical LIVE balances and
  schema_migrations checksums.
- `tests/sc010-operations.test.mjs` covers
  per-stage failure vs partial/backlog
  classifier, stale Cron alerts, secret-only
  access and strict disposable restore guard.
  Real Better Auth + PostgreSQL 17 HTTP
  tests check Cron run audit immutability,
  401/400 denial, authorized manual replay
  with reason code, 202 advisory lock overlap,
  stuck old run 503 alert and no engine activation.
  Full SC-007 before/after ledger audit
  and older SC-006/SC-009 tests still pass.

**Verified operational code commit
`c54b765407007aa5cd7037162c062adeddc81e3a`:**
- [CI SUCCESS](https://github.com/mnhtng/group-expense/actions/runs/42031601918)
- [PG17 Migration+HTTP+financial audit+fresh DB restore SUCCESS](https://github.com/mnhtng/group-expense/actions/runs/42031601882)

**Neon isolated child prepared, not schema-migrated:**
- Production: `br-round-salad-b39y4yce` (untouched).
- Development: `br-dry-poetry-b31cudmb` (untouched).
- New child from development:
  `sc010-rehearsal-20261105`, ID `br-curly-rice-b3xenws6`.
- Read-only inspected child: 10 migrations
  (001–010), original source totals; schema
  diff against development was empty.
- **No migration 011–023 on this child**:
  a separate explicit Neon schema-change
  authorization and its rollback/compare
  gate are still required. This is NOT a
  completed managed-Neon rehearsal and NOT
  permission to release money.

**Release:** PR #16 remains Draft against
`develop`, not merged. No manual staging/
production deploy or Neon shared migration.
Vercel Git may build automatic feature
previews; the un-migrated preview DB does
not constitute finance validation.
External monitoring subscription, production
backup/PITR restore drill, managed Neon
migration rehearsal, mobile physical
Chromium/WebKit/iOS/Android E2E and security/
finance stakeholder signoff remain outstanding.
The release decision is **NO-GO**.

[SC-010 operations / incident response / staged
rollout specification](./SC-010-OPERATIONS-ROLLOUT.md)
contains actionable commands, severity,
redacted alert codes, backup/rollback
policies and gated future rollout stages.

## 2026-11-05 — RR-001 isolated Neon migration rehearsal: SCHEMA PASS; RELEASE NO-GO

**Separate user authorization received after SC-010.** Only the
dedicated child `sc010-rehearsal-20261105`
(`br-curly-rice-b3xenws6`) was schema-migrated. No original
CASH/NONCASH/obligation ledger writes were performed.

- Preflight: Neon project `withered-salad-00928018`, child parent
  `br-dry-poetry-b31cudmb`, exact database `group_expense`.
  Before RR-001, child and development contained 10 migrations,
  production 6; child-parent schema diff was empty.
- Applied the original migrations **011 through 023**, with one
  PostgreSQL transaction per file, `pg_advisory_xact_lock(240011,2026)`,
  strict prior migration-count guard and SHA-256 source-file
  checksum persisted atomically. **Only the isolated Neon child changed.**
- Read-only re-verification: **23/23 exact migration SHA-256s match**.
  The normal SQL migrator would skip these installed files; the CLI
  itself was not run against Neon.
- Independent `db/sc007-audit.mjs` checks reissued as
  **REPEATABLE READ READ ONLY**: **8/8 zero violations**, including
  original cash/noncash source conservation and available balance
  semantics. No negative BN-005 live balances.
- PostgreSQL SHA-256 of full original `expenses` and `obligations`
  rows remained unchanged before and after. On development the
  independent original hashes also match; dev still has 10 migration
  versions and production 6. Neon child-parent schema diff is now
  nonempty, as required by the new DDL.
- Catalog verification: operational run table, bilateral setoff
  table, BN-005 live balances and SC-009 disputes exist; 6 BN-004
  and 13 SC-009 non-internal triggers present.
- The child has **zero** applied NONCASH, frozen snapshots, disputes
  or Cron-run evidence; positive financed/approved/disputed E2E
  scenarios remain tested on disposable PG17 CI, **not** on Neon.
  No managed-provider backup/PITR restoration has been attempted.
- Release remains **NO-GO**, `SETTLEMENT_CYCLE_ENGINE_READY=false`
  untouched, PR #16 stays **Draft** against `develop`.

[RR-001 execution evidence and verification limits](../release-readiness/RR-001-NEON-MIGRATION-EVIDENCE.md)
· [Release readiness RR-001–RR-005](../release-readiness/BACKLOG.md).

## 2026-11-05 — RR-002 browser and mobile-emulation E2E: IMPLEMENTED, EXECUTION BLOCKED, NO-GO

- Added independent GitHub Actions `.github/workflows/rr002-browser-e2e.yml` using ephemeral PostgreSQL 17, real Next.js production build, Playwright Chromium/WebKit and simulated iPhone/Android device profiles; no shared Neon and no CI finance-write bypass.
- Added signed browser interaction test `tests/rr002-browser.e2e.mjs` with four real Better Auth actors, owner/admin/counterparty/outsider access gates, consent and stale 409 snapshot handling, >50 original-source pagination, bilateral disabled money controls, active two-party dispute response/resolution privacy, network retry, persistent session and mobile touch/overflow checks.
- `tests/rr002-safety.test.mjs` asserts fail-closed exact disposable DB target, hard OFF financial engine and 44px invoice source touch target; source invoice link increased from `min-h-10` to `min-h-11`.
- Real browser runs initially exposed a JS test-fixture shadowing error (fixed) and then a genuine Better Auth HTTP 429 rate limit when creating many test identities on localhost. The test harness now honors bounded `Retry-After` and never disables auth limits.
- [Browser run #42070632696](https://github.com/mnhtng/group-expense/actions/runs/42070632696) reached test setup and documented the HTTP 429 fixture failure. Commit `31046c718b9fbce9a018644dfe35cb12ffb5b344` passed [CI](https://github.com/mnhtng/group-expense/actions/runs/42070632715) and [PG17 integration](https://github.com/mnhtng/group-expense/actions/runs/42070634602).
- On next SHA `7d556985607e5ae8cac4fb28257ae7af2b4adb7b`, CI/integration/browser GitHub jobs all failed before receiving runners (`runner_id=0`, empty steps); re-run of only the browser job repeated the runner-allocation failure. **No passing full Playwright browser interaction run is claimed**.
- Physical iOS/Android installed-PWA checks, true touch/focus/screen reader and production-like visual regression remain pending. No real money API was activated or original ledger modified by the RR-002 code.
- **Current state: RR-002 code/test suite implemented, browser gate BLOCKED and overall release NO-GO; PR #16 remains Draft.**

[RR-002 browser E2E matrix and CI blocker](../release-readiness/RR-002-BROWSER-E2E.md) · [RR-001–RR-005 release backlog](../release-readiness/BACKLOG.md).

## 2026-11-06 — RR-002 low-cost readiness: manual/label-run only

The project owner's GitHub Actions usage quota is exhausted. We preserved the high-risk finance gates, but disabled **automatic PR-commit RR-002 browser matrix** execution; browser E2E can now run only when the PR receives label `run-rr002-e2e` (or, once available on the default branch, `workflow_dispatch`). This avoids repeated expensive attempts. CI and PostgreSQL financial integration workflows remain enabled and unweakened.

Added `scripts/rr002-local.sh`, which uses a temporary loopback-bound Docker PostgreSQL 17 container and signed Chromium/WebKit browser tests. It refuses shared DB URLs, the direct PostgreSQL endpoint and financial-test override flags, and cleans up the container after a run. Added safety unit assertions and gitignored synthetic screenshot files. The shell script was syntax-checked, **not executed against a live local Docker environment**.

The four-profile browser suite and physical-device PWA evaluation remain **unverified**; RR-003 real PITR restoration, RR-004 finance/security approval, and RR-005 separate staging/release decision have NOT happened. Deferring those checks while the financial engine remains OFF is acceptable for continued development **but never authorizes production financial activation**. PR #16 stays Draft and release verdict **NO-GO**.

[Limited Actions usage decision and exit gates](../release-readiness/BACKLOG.md) · [RR-002 local runbook](../release-readiness/RR-002-BROWSER-E2E.md).

## 2026-11-07 — RR-002 local automated browser matrix: PASS 4/4; device gate pending

The owner executed `RR002_PROFILE=webkit-desktop bash scripts/rr002-local.sh` and then unfiltered `bash scripts/rr002-local.sh` against disposable Docker PostgreSQL 17. The focused WebKit run returned **2/2 tests PASS**, and the full real-browser interaction suite returned **5/5 tests PASS** (four profiles + parent): Chromium desktop, WebKit desktop, iPhone WebKit emulation, Android Chromium emulation. Migration 001–023 and idempotent second migration check, Next.js 16.4.3 production build and TypeScript were successful.

The confirmed `checkbox:focus` → fixed bottom-nav overlay → lost `pointerup` root cause was addressed centrally in CSS and protected by real pointer-event assertions. The WebKit-only controlled network failure was retested using a dedicated signed browser context with Service Workers blocked for deterministic route interception; the primary app contexts retain Service Worker behavior. Browser E2E covers stale HTTP 409, explicit re-consent, locked snapshot, original-source paging, bilateral privacy, dispute lifecycle, abort/retry, long-lived session and no ledger/CASH/NONCASH mutation. No finance engine activation or shared database writes were introduced.

**Scope:** This proves **local browser E2E PASS**, not installed PWA / physical iOS/Android correctness or overall financial release readiness. The supplied terminal log does not print a `git rev-parse HEAD`; exact-source-SHA attestation remains to be captured before final release review, along with physical-device/keyboard accessibility testing and independent CI/HTTP/integration checks. RR-003 managed Neon PITR, RR-004 independent finance/security signoff and RR-005 staged release remain PENDING. `SETTLEMENT_CYCLE_ENGINE_READY=false`, PR #16 Draft, release NO-GO.

[Browser evidence](../release-readiness/RR-002-BROWSER-E2E.md) · [Release backlog](../release-readiness/BACKLOG.md).

## 2026-11-07 — RR-002 follow-up: keyboard and device-ready evidence preparation

After the owner's **4/4 browser PASS** on disposable PG17, added a real keyboard-only **Space → Tab → Enter** snapshot locking regression on desktop Chromium/WebKit and HTTP 200 assertion for phone pointer confirmation. Local runner now prints and stores the exact tested source SHA, whether tracked files were dirty, and whether the PASS covered all four profiles versus only one; machine-readable file is written only after successful browser tests and explicitly says physical devices were not tested.

Created [physical iOS/Android installed-PWA acceptance protocol](../release-readiness/RR-002-PHYSICAL-DEVICE-ACCEPTANCE.md): 18 real-device scenarios, reviewed isolated HTTPS prerequisite, installation, session longevity, safe area, focus/keyboard/touch, offline data privacy, screen reader and immutable dispute/no-money mutation. **No remote deployment or hardware testing was performed.** Source changes to browser tests and runner after the earlier green run have **not yet passed on a developer Mac**; rerun on final code and capture `rr002-artifacts/rr002-local-result.json`. Overall RR-002 hardware/release gate is PENDING, RR-003/004/005 not started, PR Draft, engine OFF.

## 2026-11-07 — RR-002 exact-SHA local automated E2E gate: PASS

The owner ran focused macOS WebKit and then the default all-four browser matrix at **`5daf6e8e0ca5b0344d0d76896ca02266f06baf5e`** with **tracked tree clean**. Focused WebKit Node runner `tests 2 / pass 2 / fail 0`, full suite `tests 5 / pass 5 / fail 0`, all four Chromium/WebKit desktop and emulated iPhone/Android browser profiles PASS. The completed local result `rr002-artifacts/rr002-local-result.json` records this exact SHA, `fullBrowserMatrix:true`, `sourceState:clean-tracked`, `result:PASS`, `physicalDevicesTested:false` and completion `2026-11-07T13:34:35.587Z`. Disposable loopback-only PG17 migrations 001–023 and idempotent recheck plus Next.js 16.4.3 production build/TypeScript PASS. This includes the macOS WebKit native Option+Tab keyboard path and real authorized HTTP lock.

**Automated local browser portion PASS** at this exact tested code SHA. **Physical iOS/Android installed-PWA and accessibility acceptance NOT DONE**, hosted CI on final SHA not attested, no fresh independent unit/HTTP/integration evidence from this log. RR-003 Neon managed PITR, RR-004 security/financial signoff and RR-005 release authorization remain separate and pending. Financial engine hard OFF, no shared Neon changes and PR #16 Open Draft. This evidence-only documentation update does not amend the tested application/test code. See [RR-002 SHA-bound evidence](../release-readiness/RR-002-BROWSER-E2E.md).

## 2026-11-07 — RR-003: Neon recoverability preflight/tooling implemented, provider restore pending (NO-GO)

**Scope:** preparation and verified read-only provider inspection only; no provider restore/new branch, snapshot schedule change, staging deployment, schema migration, financial engine activation or real-money mutation.

- The preceding RR-002 **automated** E2E is source-SHA-bound PASS (four Chromium/WebKit/mobile-emulated profiles at `5daf6e8...`). Owner explicitly elected to defer physical iPhone/Android tests for ongoing development. Physical RR-002 remains *deferred risk*, not a false production-ready PASS.
- Provider API read-only: Neon project `withered-salad-00928018` is PostgreSQL 17 on `free_v3` with historical retention `21600` seconds = **6 hours**. `list_snapshots` returned zero, schedules for production/development/isolated child returned empty. Production `br-round-salad-b39y4yce` is primary/default, development `br-dry-poetry-b31cudmb` is parent to RR-001 child `br-curly-rice-b3xenws6`; source child is ready, nonprimary and unchanged. A single read-only SQL aggregate on that child confirms 23 installed migrations, 2 expenses, 2 obligations and 0 recorded ops runs.
- Added a pure fail-closed metadata/RPO+retention policy evaluator and tests (`db/rr003-recovery-policy.mjs`), a guarded future **READ ONLY** 15-class source/restored immutable SHA-256 conservation comparison and tests (`db/rr003-restore-compare.mjs`), and an opt-in external-HTTPS, bearer-protected, redacted GET-only `200/503` operator status probe and tests (`scripts/rr003-ops-monitor.mjs`). Local baseline artifacts are ignored from Git.
- [Recovery and ops runbook](../release-readiness/RR-003-RECOVERY-DRILL.md) records the actual provider limitations, strict project/source/destination identification, independent branch requirement, monitoring acknowledgement, explicit human RPO/RTO choices, rollback restrictions and prohibited operations. **A zero-snapshot listing is not itself proof PITR is impossible**, but neither the PITR operation nor backed-up recovery has been proven.
- Code syntax was inspected with readback parser and the pure recovery-policy/monitor classifier were checked in the isolated tool runtime. **Actual repository Node `pnpm test:unit` / PG17 / HTTP has NOT been rerun on this new SHA**; do not label full CI green.
- RR-003 final gate **NO-GO** until independent provider PITR into a specifically approved new child, 15-class conservation comparison plus positive finance fixtures, measured RPO/RTO and external authenticated 503 alert delivery/acknowledgement. A generic 'continue' does not approve actual restore. Source child, shared Neon and production remain unchanged. Financial engine remains OFF; PR #16 Open Draft.

## NEXT WORK — separate approval required

The child-only RR-001 **schema migration check is complete**.
Remaining separate readiness gates are **RR-002** device/browser E2E,
**RR-003** real Neon backup/PITR restoration and secured external
monitor, **RR-004** independent security/financial signoff and
**RR-005** separately authorized staging/cohort release. A positive
noncash fixture and authenticated role/privacy E2E on an isolated
Neon deployment have NOT been established by this read-only audit.
No feature merge, production/staging deployment, shared Neon migration,
real-money activation or expansion into BN-007 is authorized.
Any real rollout requires an explicit reviewed-SHA production decision.

## 2026-11-09 — Continuous release-readiness takeover; local verification PASS, release NO-GO

The owner's current request supersedes the former one-ticket-per-conversation workflow. RR-003 local recovery/operational verification and RR-004 agent review now accompany an RR-005 release decision package. [Evidence and source identity](../release-readiness/RR-2026-11-09-LOCAL-EVIDENCE.md), [audit findings](../release-readiness/RR-004-SECURITY-FINANCIAL-AUDIT.md), [GO/NO-GO and next approvals](../release-readiness/RR-005-RELEASE-DECISION.md).

Fixed transaction-pooling Cron lock semantics; added forward-only local migration 024 for six legacy audit tables; expanded recovery to all public data plus actual schema definitions with precise PostgreSQL text hashes; bounded/allowlisted monitor responses; exposed overdue push backlog; completed missing financial integration path filters. Historical test opt-ins are now inserted on fresh synthetic groups rather than rewriting immutable audit times.

Actual disposable PG17.11 migration/idempotency, unit/integration/signed HTTP, four-profile browser E2E, independent finance SQL and logical restore were executed locally (see source-bound evidence for exact results). No hosted CI was started. No Neon write/resource mutation, shared migration, deployment, merge, push or engine activation. PR #16 remains Draft. Managed provider restore/external alert delivery, independent finance/security review and runtime-role verification, real-device/PWA acceptance and staging/production authorization remain pending. The Neon child has **23** migrations while source adds **024**; old RR-001 evidence does not certify the new migration.

## 2026-11-09 — Managed historical recovery and restricted runtime verification

The owner separately approved the Free-only isolated PITR scope. Snapshot creation rejected the approved non-root source; Console historical branching recovered it to **`br-noisy-river-b3ajidmw`** at provider-attested **`2026-11-09T13:00:31Z`**. All **58/58** source/restored digests match, the source is unchanged, and **8/8** independent finance audits are zero on each branch. New compute was observed idle; the branch is retained for review. No snapshot, shared migration, paid upgrade, deployment or activation occurred. [Managed receipt and timing/coverage limits](../release-readiness/RR-003-MANAGED-PITR-EVIDENCE.md).

Local continuation: **171 unit and 11 PG17 integration PASS**; standard and genuine non-owner application profiles both pass production build, signed HTTP, four browsers and independent finance audits. The new runtime grant/evaluator policy blocks administrative/DDL/temp authority, audit edits, direct money edits and owner impersonation; fixture owner credentials remain separate. This is tested local isolation, not certification of a deployed Neon login. Dependency fixes update affected minimatch to 11.0.1 and pin a tested deepmerge patch; registry audit retains **one low**, zero moderate/high/critical, with independent patch/risk acceptance pending.

Baseline committed locally as `16fba847df1bab7b2ef9b31dd3e0e582724b2771`; continuation verified code digest `359eebf5ac4fab9b87ad80b8fd49f139ee99c5f05780aec1a10633fbb18eaf26`. [Continuation evidence](../release-readiness/RR-2026-11-09-CONTINUATION-EVIDENCE.md). Neon source/restored child retain 23 migrations; applying 024 to the new child awaits separate approval. External delivery/operator acknowledgement, service RPO/RTO, positive managed finance fixtures, physical hardware/PWA, deployed runtime-role proof, independent finance/security signatures and staging/production authorization remain pending. **NO-GO, engine OFF, PR #16 Draft; no push.**


## 2026-11-09 — Separately approved migration 024 on PITR child: PASS

Owner approved **only 024** on `br-noisy-river-b3ajidmw`. The credential-private connector applied the exact versioned SQL and checksum in an advisory-locked transaction after checking all 23 prior checksums and 58 target baseline digests. No earlier SQL was reapplied. Target now has **24/24 matching migration checksums**, **12 enabled audit triggers**, and managed function/trigger definition hashes identical to the tested local schema. **55/58 digest classes unchanged**; only migration history, function definitions and triggers changed as designed. All **8 independent finance audits are zero on target and source**. Repeating the package is a no-op preserving all **58/58** post-migration digests. Original source retains 23 migrations and 58/58 unchanged hashes.

[Exact authorization, transaction and preservation evidence](../release-readiness/RR-001-024-NEON-MIGRATION-EVIDENCE.md). This supersedes the preceding pending-024 approval status. No financial/audit data DML, shared migration, role grant, paid upgrade, push, merge, deployment or activation occurred. Remaining live-role, positive managed finance, service RPO/RTO, external monitor/operator, physical-device and independent acceptance gates keep release **NO-GO**, PR Draft and engine OFF.


## 2026-11-09 — Runtime attestation, alert lifecycle and owner recovery targets

Added the protected read-only runtime endpoint using the actual application pool, separate monitor-only token, stricter table/column/default-privilege and 19-trigger verification, and a private persistent alert outbox with retry/escalation/manual acknowledgement/recovery. **176 unit + 12 PG17 integration PASS**. Both limited and owner full build/HTTP/four-browser/audit profiles pass; limited runtime attestation returns 200 and owner returns 503. Logical restore still passes all 58 data/schema comparisons. Exact code digest and [current evidence](../release-readiness/RR-2026-11-09-RUNTIME-ALERT-EVIDENCE.md).

Owner approved **RPO ≤15m / service RTO ≤60m**, selected email, supplied a private recipient and explicitly confirmed reading one Gmail drill. This closes that mail-channel component, not scheduled end-to-end monitoring. [Delivery/operator protocol](../release-readiness/RR-003-ALERT-DELIVERY.md). Read-only Vercel metadata has no feature-branch DB/secret overrides; live runtime certification needs the [prepared isolated role + protected preview action](../release-readiness/RR-004-ISOLATED-PREVIEW-PLAN.md). No provider role/ACL/env/deployment mutation was performed in this continuation at this point. Remaining hosted automatic mail/scheduler, service recovery, positive managed finance, devices and independent reviewer gates keep release NO-GO, PR Draft and engine OFF.


## 2026-11-09 — Approved managed runtime + protected preview PASS

Owner approved the exact `3739fc6…` role/feature-preview package. Created scoped LOGIN `rr004_app_20261109` only on recovered child `br-noisy-river-b3ajidmw`, applied the explicit current/future grant matrix, and connected with that real limited login: 53 table/view profiles and 19 guards PASS, no owner/admin/membership/DDL/temp authority, eight zero finance audits. All 58 digests remain unchanged through role setup and app GETs. Four new sensitive envs target **only** the feature preview; all 16 pre-existing entries and SSO unchanged.

Protected preview `dpl_EqHn5GRrhCK3HfvcSojhkAnYhgJq` READY at the exact reviewed SHA. Actual GET `/runtime` **200** with expected role/connection fingerprints, missing/wrong token **401**, `/status` **503 / NO_COMPLETED_CRON_RUN**. Access used temporary OIDC; no project-wide bypass or Cron replay. [Full receipt/source-handling evidence](../release-readiness/RR-004-MANAGED-RUNTIME-EVIDENCE.md). This supersedes the earlier pending isolated-deployment proof, not production/develop parity. [Standalone Resend Free provisioning](../release-readiness/RR-003-MAIL-PROVISIONING-PLAN.md) is proposed separately; hosted automatic mail/scheduling and real recovery-to-healthy remain pending. Release NO-GO, engine OFF, PR Draft, no push/merge/staging/production deploy.


## 2026-11-09 — Resend Free installation verified; sender domain pending

The owner authorized the exact **Accept & Install** action. The correct Vercel team page subsequently showed **Terms Already Accepted**, and CLI confirmed Resend marketplace installation `icfg_J0I3yo7hfcdtAJL3H9okuSz1`, plan `free`, cost `0.00`, zero connected projects. The named resource creation stopped before provisioning because an owned sender `domain` and `region` are required. Only `group-expense.vercel.app` is configured on this project; the owner has been asked for their own sender domain or to state Gmail-only availability. No domain/DNS mutation, paid plan, email key retrieval or app env injection occurred. [Current mail provisioning state](../release-readiness/RR-003-MAIL-PROVISIONING-PLAN.md). Source and prior verified runtime preview remain unchanged; automatic mail and scheduler gates are still pending.

## 2026-11-09 — Email deferred by owner

The owner confirmed Gmail-only availability, then explicitly requested skipping the email feature. Stop provisioning, account/key setup and further email drills; no domain/account input is pending. Resend owner-inbox test mode was researched but not activated; a read-only browser check reached the login page. No named resource, API key or additional email was created. Retain the existing Free installation with zero connected projects. Generic HTTPS monitoring/outbox code and the previously verified application source are unchanged. Hosted external notification/scheduling, service RPO/RTO, positive managed finance fixtures, physical devices and independent signoff remain open. Email deferral is not RR-003 acceptance. Release NO-GO, engine OFF, PR Draft.

## 2026-11-09 — Owner-requested PR staging/production execution started

Owner requested feature → develop/staging → main/production, agent review/merge and no further questions. [Execution record](../release-readiness/RR-005-RELEASE-EXECUTION.md) supersedes the former deployment authorization hold; it does not certify independent review, hardware or financial activation. Email remains deferred, engine stays OFF. GitHub branches have no protection/rulesets; old hosted jobs were blocked from starting by account billing. No paid runner change attempted.

Created two compute-free pre-migration backups and one production-clone rehearsal on Neon Free (seven total branches/limit ten). Captured original-column hashes on all 25 staging/20 production tables. Current Node22 regression: 176 unit +12 PG17 integration, eight finance audits, limited-role build/HTTP/four browsers PASS at unchanged code digest `03757fec…`; first HTTP connection interruption and successful fresh rerun are documented. Automatic approval review twice rejected the necessary 007–024 transaction on the new rehearsal branch, requiring direct owner confirmation beyond the older PITR-only migration approval. No rejected action was bypassed; no shared schema/env mutation, merge or staging/production deployment occurred. Continue unaffected PR preparation; dependent release steps await that review boundary.

## 2026-11-09 — Local production-app rollback compatibility PASS

While the direct confirmation required by automatic review remains pending, tested exact existing production app `b0c7e0e…` from an isolated archive with its own frozen/offline dependency lockfile. Node22 production build/TypeScript and the old signed HTTP suite PASS against fresh local PG17 **schema001–024** under the reviewed non-owner role; eight current finance audits and post-run ACL profile PASS. The initial audit invocation lacked its disposable-only flag and refused; the corrected fresh-container check passed without weakening guards. [Scope and private receipt references](../release-readiness/RR-005-RELEASE-EXECUTION.md). This is local rollback compatibility, not a managed rollback or deployment. PR16 and develop/main heads were re-read and remain unchanged. No push, merge, managed migration/env mutation or engine activation.

## Approved release continuation — rehearsal/staging schema and role PASS

Owner directly approved the complete migration/runtime/public-metadata/PR package, resolving the earlier automatic-review hold. Rehearsal 007–024 PASS with 24 matching checksums, 20 unchanged original tables and eight zero audits. Staging 011–024 PASS with 24 checksums, 16 unchanged original business tables and eight zero audits. Sensitive credential/session/invitation/push-diagnostic tables are excluded from subsequent preservation assertions as required by automatic review. Fresh staging app role passes the 53-object/19-guard policy; staging pooled DB/read token configured and direct owner runtime URL removed. Other 18 env entries and SSO unchanged. [Execution receipts](../release-readiness/RR-005-RELEASE-EXECUTION.md). Next: PR16 staging deployment acceptance, then production PR/migration/deployment. Engine OFF and email deferred.

## Application released through PRs — staging then production verified

[PR16](https://github.com/mnhtng/group-expense/pull/16) merged feature→develop at `ce985f0…`; Vercel staging READY and20 actual GET/runtime/auth/PWA assertions PASS on deployment URL and develop alias. Only then [PR17](https://github.com/mnhtng/group-expense/pull/17) merged develop→main at `2017567…`; production READY and10 assertions PASS at `https://group-expense.vercel.app`, including exact main SHA/limited-role/database attestation. Technical reviews are COMMENT entries from the author's account, not fabricated independent approvals; merges use expected-head SHA. Hosted jobs cannot start due to GitHub billing; no rules/protection or billing limits were changed.

Production007–024 is atomic, all24 checksums match,11 original business tables preserved and eight audits zero. Both runtime roles pass53-object/19-guard policy; direct owner runtime URLs removed, existing auth/VAPID/Cron and SSO preserved, backups retained. [Full deployed evidence and limits](../release-readiness/RR-005-RELEASE-EXECUTION.md). App rollout is complete; financial engine remains OFF, email deferred. Ops503 only NO_COMPLETED_CRON_RUN remains; no manual replay. Hardware, independent signoff, external alerting and full-service RPO/RTO are not certified. Documentation-only follow-up merges preserve the tested app digest; current deployment provenance is recorded in closing PR comments.
