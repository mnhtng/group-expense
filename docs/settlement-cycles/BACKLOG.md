# Settlement Cycles + Bilateral Debt Set-off — Implementation Backlog

> Repository: `mnhtng/group-expense` | Base: `develop` | Working branch: `feat/settlement-cycles-bilateral`.
> STATUS: DESIGN LOCKED / INCREMENTAL IMPLEMENTATION. This document is the canonical cross-conversation task list.
> Hard constraint: **one backlog ticket per conversation**. Do not work on the next ticket until the current ticket's CI and database tests are completed. Do not merge to `develop`, deploy, or migrate a shared database without a separate release decision.

## Rules that are never negotiable

1. Settlement-cycle functionality is **OFF for all existing and new groups**. No changes to manual invoice/payment behavior before explicit opt-in AND engine readiness.
2. Only the group owner may grant/revoke `manage_settlement_cycles` to one or many currently active members. An authorized delegate can configure the feature, but cannot delegate, transfer ownership, edit others' invoices, or confirm payments on behalf of the counterparties.
3. Invoice modification and invoice completion remain **creator-only**, regardless of group owner/admin/delegate status.
4. A repayment still requires confirmation by the actual two counterparties; a cycle manager cannot impersonate either party.
5. Bilateral netting is strictly **one pair (A,B) within one group, one currency, one eligible settlement scope**. NEVER re-route debt through C or apply cross-group multi-party netting.
6. Proposed set-off is NOT cash. Separate `confirmed_cash`, `confirmed_setoff`, and pending reservations. Both A and B must approve the same immutable proposal version before an atomic ledger application.
7. Keep original expenses, item shares, obligations, and approvals immutable/auditable; a cycle is a projection/snapshot, not a duplicate invoice or a second source of money.
8. `outstanding=original-confirmed_cash-confirmed_setoff`; pending amounts reserve availability but never count as confirmed payment. Preserve exact integer minor units; never floating-point money.
9. Every financial write must have authz, transaction/locking discipline, optimistic concurrency, idempotency, audit events and tests including retry/race/failure.
10. Do not auto-claim that a cycle is completed while any outstanding obligation, unresolved proposal, payment pending confirmation, or creator-uncompleted invoice remains.
11. Existing groups and existing debts must remain unchanged while disabled. Do not silently migrate old obligations into a new cycle.
12. No destructive `DROP`/`DELETE` of financial history, no changing production/main without explicit release authorization.

## One-conversation-one-ticket protocol

1. Read **this** file and `DOMAIN_RULES.md` from the feature branch. Pick exactly the first `NEXT` item whose prerequisites are met.
2. Inspect relevant existing `develop` code and existing feature branch diff; implement **ONLY** selected ticket.
3. Make targeted migrations, routes, UI and tests **only within that ticket's acceptance scope**; no follow-on algorithm/ledger changes.
4. Run lint, typecheck, unit and integration/HTTP tests using isolated DB branch. Verify invariants and negative authorization before claiming completion.
5. Update the ticket status and `PROGRESS.md`: SHA, tests, blockers, known gaps, next ticket, no secrets.
6. Open/update a **draft PR** toward `develop` for review; never merge automatically. Staging/production deployment is a separate controlled gate.
7. If tests fail or external tool is unavailable, mark `BLOCKED`, be transparent, and **do not** start the next ticket.

## Dependencies / status

| ID | Priority | Deliverable | Dependencies | Status |
|---|---|---|---|---|
| SC-001 | P0 | Safe feature flags + owner/delegate grants + authz, default OFF, audit, backward compatibility; **NO financial calculation** | none | DONE ON FEATURE BRANCH — CI + HTTP/DB PASS; PR REVIEW PENDING |
| SC-002 | P0 | Cycle configuration: timezone/anchor/frequency/ranges, versioning, safe future-only changes | SC-001 | DONE ON FEATURE BRANCH — CI + DB/HTTP PASS; NO ENGINE ACTIVATION |
| SC-003 | P0 | Cycle state machine / immutable cycle identity + overlap prevention + manual/cron transitions | SC-002 | DONE ON FEATURE BRANCH — CI + DB/HTTP PASS; NO FINANCIAL ACTIONS |
| SC-004 | P0 | Eligible obligation snapshots: date boundary, cash confirmed/pending, late bills, frozen versions, canonical SQL | SC-003 | DONE ON FEATURE BRANCH — CI + DB/HTTP PASS; REVIEW PENDING |
| SC-005 | P0 | Same-direction batch repayment by pair, 50+ allocations, idempotent requests and scoped confirmation | SC-004 | DONE ON FEATURE BRANCH — CI + DB/HTTP PASS; RELEASE GATED OFF |
| BN-001 | P0 | Pairwise bilateral calculator (pure BigInt) + deterministic allocation and eligibility rules | SC-004 | DONE ON FEATURE BRANCH — CI + DB/HTTP PASS; NO LEDGER |
| BN-002 | P0 | Bilateral proposal persistence, one group+cycle+pair+version, stable fingerprint and conflict handling | BN-001 | DONE ON FEATURE BRANCH — CI + POSTGRES/HTTP PASS; NO APPROVAL / NO LEDGER |
| BN-003 | P0 | Dual approval with identities, invalidation/rejection/expiry/revoke, no auto-apply | BN-002 | DONE ON FEATURE BRANCH — CI + DB/HTTP PASS; NO NONCASH LEDGER |
| BN-004 | P0 | Atomic two-sided NONCASH application under row locks, exact A↔B conservation, immutable original-source audit; no persistent interim reservations | BN-003 | DONE ON FEATURE BRANCH — CI + PG17/HTTP VERIFIED; NOT RELEASED |
| BN-005 | P0 | Integrate `confirmed_setoff` into **all** outstanding, available, leave/archive, paid, completion and report queries | BN-004 | DONE ON FEATURE BRANCH — CI + PG17/HTTP VERIFIED; NOT RELEASED |
| BN-006 | P0 | Net residual cash settlement through the pre-existing two-party confirmation flow | BN-005,SC-005 | DONE ON FEATURE BRANCH — CI + PG17/HTTP VERIFIED; NOT RELEASED |
| SC-006 | P0 | Immutable next-REVIEW attribution of late original invoices; recurring catchup order; leave/creator/recurring-template/archive guards; no historic edits or unlock | SC-004,BN-005 | DONE ON FEATURE BRANCH — PG17/HTTP VERIFIED; NOT RELEASED |
| SC-007 | P0 | Full financial concurrency, authz, property-based and HTTP E2E regression suite; fail-closed release gate | SC-006,BN-006 | DONE ON FEATURE BRANCH — CI + PG17/HTTP AUDIT PASS; RELEASE NO-GO |
| SC-008 | P1 | Cycle and set-off mobile UI: list/review/confirm, per-obligation traceability, clarity for each role | SC-007 | TODO |
| SC-009 | P1 | In-app notifications, reminders, disputes, late adjustments, audit/export and reconciliation reports | SC-008 | TODO |
| SC-010 | P1 | Operational runbooks, cron catch-up, monitoring, recovery / rollback, staged production rollout | SC-009 | TODO |
| BN-007 | P2 | Optional future refinements strictly **within two parties**, never 3+-party debt simplification | SC-010 | BACKLOG |

## SC-001 — completed in first conversation (code in draft PR #16)

**Scope:** isolated schema for settings & grants; default-off, separate owner/grant manager access; owner-only delegation; deny all writes to non-members/archived groups; session-authenticated, validated API; minimal mobile-safe configuration UI with clear **"not active until engine rollout"** label; audit and revocation across leave/rejoin/owner transfer; unit + integration + HTTP tests.

**Forbidden in SC-001:** changing `obligations`, `settlements`, `expense_events`, `expense_completion_events`, monetary balances, repayment state, cycle-calculation or set-off execution.

**Acceptance tests:**
- Existing/new groups with no config row return `enabled=false`, `bilateral_netting_enabled=false`; no financial behavior changes.
- Owner alone can grant/revoke independent right to active members; not to inactive, outsiders, self, or archived groups; delegates cannot grant/revoke. `admin` without delegation denied.
- Owner and currently active authorized delegates may update settings; non-delegates denied; deactivated group denied. Disabling cycle mode forces bilateral OFF.
- No stale delegate rights after leave, rejoin, or owner change. Changes are recorded in append-only audit with actual actor.
- Concurrent updates cannot lose settings changes: version and transaction checks; repeated stale requests fail predictably; no duplicate grants.
- Invalid JSON, IDs, bad booleans, oversized bodies and unexpected fields fail with controlled 400 responses, not SQL 500.
- No consumer enables actual money behavior until SC-003+SC-007 release gates are passed. Mark configuration as **preparation only** in UI.
- CI green with an isolated test database and constraints checked; no action on `main`/production.

## SC-002 — completed in second conversation (code in draft PR #16)

**Scope:** versioned, future-only schedule metadata; weekly/biweekly/monthly/manual calendars,
strict local date + IANA zone handling, half-open period boundaries, safe cutovers
at existing period boundaries only, owner/delegate API authorization, audit,
database immutability, and a preview-only UI panel.

**Hard exclusions:** do not create cycle records or run a cycle engine (SC-003),
do not calculate eligibility/snapshots (SC-004), do not create cash or set-off
allocations (SC-005, BN-*), do not enable the engine release gate.

**Acceptance:** first schedule may start only after the current local date.
A running schedule is immutable; future changes must be aligned to the old
period boundary, and timezone changes must preserve the exact UTC cutover.
Previously scheduled, not-yet-effective changes may be superseded under
group lock and expectedVersion; history/audit must be preserved.
Invalid IANA zones/dates and ambiguous DST midnight rejected.
Tests must exercise a 31st-day monthly anchor, a biweekly anchor, stale
and concurrent updates, revoked/unauthorized delegates and a zero-mutation
ledger assertion. The existing configuration and monetary behavior remain OFF.

**Detailed operational contract:** [SC-002-SCHEDULE.md](./SC-002-SCHEDULE.md).

## SC-003 — lifecycle metadata and audit (third conversation)

**Implementation scope (strictly this ticket):**
- Metadata-only periods, half-open local/UTC ranges, immutable identity,
  PostgreSQL `btree_gist` exclusion against overlapping periods across
  revisions and timezones, one idempotent manual request per key.
- `OPEN (v1) -> REVIEW (v2)` is the **only** allowed transition.
  SC-004 alone will add financial review/snapshots and any LOCKED transition.
- Owner/delegate may create manual cycles under a manual schedule, request
  review after the period, or refresh automatically scheduled metadata.
  Admin without delegation cannot.
- Cron metadata processing is bounded and fair, catches up delayed periods
  only from the group's most recent explicitly audited opt-in.
  A disabled, archived, or never-enabled group cannot create new cycles.
- Existing SC-001 financial engine flag stays OFF. There is no financial
  attribution, repayment, set-off, invoice completion or real-money lock.
- Snapshot creation, obligation eligibility and monetary calculations remain
  **explicitly prohibited** in this ticket.

**Required acceptance:** PostgreSQL schema/FK/unique/exclusion/immutability,
no overlap and adjacent-boundary acceptance, delayed cron idempotency,
two simultaneous manual creation requests, valid opt-in window, no
retroactive import, safe old/new schedule cutover and no change to existing
ledger tables. Validate session and owner/delegate permissions, revocations,
stale versions, early reviews, and duplicate actions. Run CI + disposable
Postgres/HTTP and record actual results in PROGRESS.md before marking DONE.

See [SC-003-LIFECYCLE.md](./SC-003-LIFECYCLE.md) for all state semantics.

## SC-004 — completed in fourth conversation (Draft PR #16)

**Scope:** canonical ledger eligibility over the entire group's obligations
(no 100/500 row cap), exact local `[start,end)` invoice dates,
`deleted_at`/`voided_at` exclusions, recorded-at cutoff, frozen expense
and obligation versions, confirmed vs pending cash and explicit conservation.
Manager approves a preview fingerprint; group-locked atomic transaction
persists immutable source snapshots, verifies actual persisted data and
moves `review (v2) -> locked (v3)` with append-only audit.
A snapshot is NOT a debt discharge, cash transfer or invoice completion.
The SC-001 financial-engine-ready flag remains false.

**Acceptance evidence:** SQL migration installed twice on disposable PG17;
CI lint/typecheck/unit/build; HTTP with 551 source obligations,
confirmed/pending money, wrong/stale fingerprint, simultaneous owner/delegate
locking, idempotent retry, exclusive end boundary, deleted bill exclusion,
post-lock late invoice, creator-only completion after cash confirmation.
No automatic adjustment to a future cycle (SC-006), no grouped repayment
(SC-005), no two-way set-off (BN-*).

**Canonical detailed spec:** [SC-004-SNAPSHOTS.md](./SC-004-SNAPSHOTS.md).
**Financial release gate:** remain Draft, do not merge/deploy/migrate shared
Neon, do not enable actual settlement engine until future P0 reviews.

## SC-005 — completed in fifth conversation (Draft PR #16)

**Scope:** one locked cycle + one debtor→creditor direction, all LIVE
available original obligations, one standard `settlements` pending cash
request, 50+ original allocation rows, real other-party confirm/reject,
initiator cancellation, immutable provenance and exact BigInt sums.
It never creates a noncash set-off or automatically completes a cycle.

**Acceptance:** CI-only disposable PostgreSQL 17 fixture executes actual
HTTP money writes while the production global financial-engine constant
remains FALSE. 550 allocations from original source invoices in a single
`pending` settlement; outdated fingerprint on changed cash; double-key
and same-key races; duplicate notes; no admin impersonation; source pair
and cycle must match; confirmed/pending/rejected/cancelled live balances;
SQL immutability; disabled-group retries but no new cash writes.

**Implementation:** `015_settlement_cycle_batch_repayments.sql`,
`lib/settlement-cycles/repayments.ts`,
`app/api/groups/[groupId]/settlement-cycle/cycles/[cycleId]/repayments/route.ts`,
extended `preview-http.smoke.mjs`.
Canonical contract: [SC-005-BATCH-REPAYMENTS.md](./SC-005-BATCH-REPAYMENTS.md).

**Hard exclusions:** No BN-* bilateral netting, no SC-006 late adjustment
attribution, no SC-008 full mobile UI, no automatic debit/transfer,
no financial engine activation, no shared Neon migration or release.
Batch status `pending` does NOT discharge debt; the two original
counterparties alone control confirmation.

## BN-001 — pure bilateral offset calculator (current conversation)

**Implementation:** `lib/settlement-cycles/bilateral-calculator.ts`.
Only one active pair (A,B), one group, one LOCKED cycle and one currency
(VND); exactly one half-open local `[start,end)` interval. Every input
original obligation is verified for scope, snapshot attribution, nonvoid
status, undeleted source invoice and equal snapshot/live expense version.
Unexpected third persons, duplicate source IDs, wrong period, currency,
negative/overbooked money or malformed input fail CLOSED.

All money computations use BigInt:
`outstanding=original-confirmed_cash-confirmed_setoff`,
`available=outstanding-pending_cash-pending_setoff`,
`offset=min(SUM(available_A_to_B),SUM(available_B_to_A))`.
Apply exactly the SAME hypothetical set-off amount against both directions,
oldest original invoice date then canonical obligation UUID, with no
floating point, loss of audit or input mutation. The resulting allocations
are **not** paid, approved or persisted.

**Test:** `tests/bilateral-calculator.test.mjs` covers 16 independent
scenarios including two-way conservation, one-sided/zero/full-paid,
partial confirmed cash/set-off, pending cash/set-off, cancelled reservations,
reversed pair labels, stale dates/versions, cross-group/cycle/3rd party,
exact BigInt, 1,200 deterministic property scenarios and 10,000 sources.
Direct independent JS-equivalent execution: 16/16 passed.
Final BN-001 verification PASSED on commit `45279fa2182728857229813e90e7f2cb4a1657c3`:
[CI (86 unit tests)](https://github.com/mnhtng/group-expense/actions/runs/41938338962),
[PostgreSQL/HTTP regressions](https://github.com/mnhtng/group-expense/actions/runs/41938338952).
Real-world six-invoice weekly dinner example: 190,000 VND per direction
netted hypothetically, A->B available residual 15,000 VND; no actual
payment, proposal or stored set-off. Reproducible experiment fixture:
`tests/bilateral-calculator-experiment.test.mjs`.

**Detailed contract:** [BN-001-CALCULATOR.md](./BN-001-CALCULATOR.md).

**Explicit exclusion:** No BN-002 proposal/fingerprint, BN-003 approvals,
BN-004 ledger, SC-006 late adjustments, financial schema or API changes.
`SETTLEMENT_CYCLE_ENGINE_READY=false`, Draft PR #16, no deployment or
shared Neon migration.

## BN-002 — one-pair versioned proposals (current conversation)

**DONE on feature branch; NOT RELEASED.** Authenticated, explicit bilateral
opt-in; exactly two active counterparties within one locked cycle and VND.
A canonical unordered pair has exactly one atomic version HEAD. Every
proposal version and all original-obligation source proof rows are IMMUTABLE.
No proposal reserves money, automatically confirms payment or applies set-off.

**DB:** `016_bilateral_proposal_documents.sql` with unique pair/version
and actor/request-key constraints, append-only proposal/source triggers,
cycle snapshot composite FKs, full source count and exact symmetric
money conservation. SQL publication trigger also checks
`offset=min(available_A_to_B,available_B_to_A)` and **BN-001 FIFO**
(local day, UUID), preventing two equal but arbitrarily misallocated sums.
Creator-only invoice completion metadata version is recognized without
changing original financial source values.

**Service/API:** `lib/settlement-cycles/proposals.ts`,
`GET/POST /api/groups/:groupId/settlement-cycle/cycles/:cycleId/bilateral-proposals`.
Canonical ledger fingerprint includes immutable snapshot and ALL live
original source/cash statuses, including pending and zero-available rows.
Group→cycle→pair head→original obligations are locked before checking
`expectedVersion` and `expectedFingerprint`. Same-key retried
requests recover their original ID; stale or racing version returns 409.
Party-only auth; unrelated owner/admin/delegate denied.

**Tests:** 122 original obligations (61 per direction, >50 each),
different-key race [201,409], same-key race [201,200], explicit opt-in,
rejected fake fingerprint and foreign actor, stale fingerprint after cash
confirmation, immutable historical revision, SQL update/delete guards,
failed raw SQL canonical-FIFO spoof rollback, creator completion, no
proposal-created money/ledger changes, group disable and read-only history.
[CI success](https://github.com/mnhtng/group-expense/actions/runs/41944569337);
[disposable PostgreSQL17/HTTP success](https://github.com/mnhtng/group-expense/actions/runs/41944569536).
See [BN-002-PROPOSALS.md](./BN-002-PROPOSALS.md).

**Hard exclusions:** BN-003 approvals/rejections/expiry, BN-004 actual
noncash entries, BN-005 balance integration, SC-006 later adjustments and
any production activation. Financial engine flag remains OFF. PR #16
remains Draft; no shared Neon migration, merge or deploy.

## BN-003 — independent counterpart decisions (current conversation)

**DONE ON FEATURE BRANCH; FINANCIAL RELEASE STILL OFF.**
The existing BN-003 implementation was validated against full
PostgreSQL 17 + HTTP CI. Hardening added to migration 017 prohibits
raw SQL `reject` and `revoke` after the original source is
stale, eligibility is revoked or the proposal has expired. The same
state rules apply to `approve`, with strict one-signature-per-person
and one-terminal-event-per-proposal invariants.

**Source files:** `017_bilateral_decision_events.sql`,
`lib/settlement-cycles/decisions.ts`, authenticated
`GET/POST /bilateral-proposals/:proposalId/decisions`.
Append-only signatory decisions `approve/reject/revoke`, durable
system `invalidated/expired`, 72-hour deadline, current-head
version and source fingerprint. Two separate approvals yield
`agreed`, NEVER `applied` or `paid`. No noncash set-off row,
no pending noncash reservation, no invoice or money mutation.

**Final verified commit `6cdd80fa3aa11fd0432d2847c5714dbd46c982e1`:**
[CI SUCCESS](https://github.com/mnhtng/group-expense/actions/runs/41962695419);
[PostgreSQL/HTTP SUCCESS](https://github.com/mnhtng/group-expense/actions/runs/41962695398).
Tests cover two actual counterpart signers and unrelated admin denial,
same-key concurrent retries, approval versus rejection, revoke after
agreement, terminal immutable history, 72-hour expiry and forged
direct SQL late reject/revoke, cash-status source invalidation,
reversal of pending cash not resurrecting approvals, opt-out,
member leave/rejoin, group archive and no financial-application writes.

Detailed contract: [BN-003-DECISIONS.md](./BN-003-DECISIONS.md).
Release remains blocked: PR #16 Draft; no shared Neon migrations,
no deploy or merge, `SETTLEMENT_CYCLE_ENGINE_READY=false`.
BN-004 may be started only in a separate future conversation.

## BN-004 — atomic noncash set-off application (this conversation)

**DONE ON FEATURE BRANCH; FINANCIAL RELEASE REMAINS OFF.**
BN-004 creates ONE immutable, noncash two-sided application for one
fully signed BN-002 source proposal; no unapproved, revoked, expired,
superseded or stale set-off may be applied. Two source directions must
be exactly equal in VND, referencing original obligations and
the BN-002 FIFO immutable source proof.

**DB:** migration `018_bilateral_noncash_applications.sql` adds
append-only application documents and obligation-level allocations,
one application per original group/cycle/pair and no duplicate discharge
of an original obligation. PostgreSQL trigger verifies two distinct
BN-003 approvals, active source, exact proposal, opt-in and current
head. A deferred constraint trigger verifies BOTH complete directional
sums/counts before COMMIT. SQL direct writers cannot post only one
side, forge allocations, edit/delete audit or race a signature revoke.
The rows are ledger PROOF of NONCASH discharge only; they never create
a cash payment, mutate original obligations or mark any invoice paid.

**Service/API:** `lib/settlement-cycles/applications.ts` and
authenticated `GET/POST .../bilateral-proposals/:proposalId/applications`.
Recompute entire live BN-002 fingerprint under group->cycle->head/
proposal->obligation locks; reject pending/confirmed cash change,
expiry, revoked/invalidated signatures and duplicate pair application.
Requests use session actor, immutable version/fingerprint and UUID
idempotency key. Concurrent same-key retries return ONE document.
The POST write is enabled **ONLY** with three simultaneous disposable
CI conditions `CI=true`, `BN004_TEST_ONLY=isolated-pg17`,
`DATABASE_URL=postgresql://test:test@localhost:5432/group_expense`.
The global `SETTLEMENT_CYCLE_ENGINE_READY=false` remains unchanged.

**Acceptance evidence:** `tests/preview-http.smoke.mjs` exercises
122 original source obligations, two signers, outsider denial, one-
sided SQL rollback, immutable audit, exact per-source source proof,
concurrent request replay and cash-table nonmutation. The native unit
suite guards release gates and SQL invariants; disposable PG17 applies
all migrations twice. See [BN-004-NONCASH-APPLICATIONS.md](./BN-004-NONCASH-APPLICATIONS.md).

**Hard exclusions:** BN-005 balance, leave/archive/report and invoice
completion integration; BN-006 residual cash; SC-006 adjustments;
SC-008 UI; notifications, release, shared Neon migrations and
staging/production deployment. There are NO persistent pending setoff
reservations: both original sides are row-locked and applied atomically
in one transaction, rather than staged as a pending reservation.
PR #16 remains Draft and unmerged.

## BN-005 — canonical live cash + confirmed noncash accounting (this conversation)

**DONE ON FEATURE BRANCH; NOT RELEASED.** New migration
`019_bilateral_setoff_balance_integration.sql` defines a single
`bn005_obligation_balances` view over ORIGINAL obligations. The exact
equations are `outstanding=original-confirmed_cash-confirmed_setoff`
and `available=outstanding-pending_cash` (BN-004 has no persistent
pending-setoff reservations). Cash statuses remain distinct from
the immutable BN-004 confirmed noncash application, with no synthetic
bank transfer, duplicate invoice or change to frozen snapshot amounts.

**Consumers:** original group/personal debt and debt-detail reports,
uncapped group totals, manual cash availability, SC-005 batch preview,
BN-002 source previews (with same pair+cycle replay refused),
creator-only invoice progress/completion, leave and archive guards.
Expense and debt cards disclose cash and noncash as SEPARATE categories
while showing combined discharged obligations; no setoff is displayed
as a bank transfer. PostgreSQL frozen completion trigger recognizes
noncash discharge without granting noncreator approval.

**Fail-closed:** database deferred constraints protect cash allocation
creation/status changes and noncash proof insert from spending more than
the original balance. Negative live balances block exit, archive and
invoice completion. Cash still uses the original bilateral confirmation.
All queries derive live balances from the canonical view under existing
group/obligation write locking. No UI pagination limit enters rollups.

**Tests:** migration installed twice on disposable PG17;
CI lint/typecheck/unit/production build; full SQL/HTTP regression with
122 original obligations, bilateral conservation, source setoff audit,
manual cash overdraw denial, direct SQL overdraw rollback, client/server
report agreement, creator-only completion after noncash discharge,
leave/archive blocking, SC-005 preview and pending cash cancellation
and confirmation against the residual. The original noncash proof and
cash histories stay immutable.

**Contract:** [BN-005-BALANCE-INTEGRATION.md](./BN-005-BALANCE-INTEGRATION.md).
**Hard exclusions:** BN-006 residual-cash workflow; SC-006 late
adjustment/membership lifecycle improvements; SC-008 UI expansion;
group/cycle finance activation; Neon/staging/production migrations;
merge to `develop`/`main`. PR #16 remains Draft,
`SETTLEMENT_CYCLE_ENGINE_READY=false`.

## BN-006 — original-source net residual cash, real two-party confirmation

**DONE ON FEATURE BRANCH; NO REAL FINANCIAL RELEASE.** Creates one
ordinary pending cash settlement and all original-obligation allocations
for the ONLY remaining direction after a committed BN-004 two-sided
set-off. The amount is live BN-005 outstanding, not old snapshot money,
and no third party or other group/cycle is involved.

**Implementation:** migration
`020_bilateral_residual_cash_repayments.sql`,
`lib/settlement-cycles/residual-repayments.ts` and the authenticated
`GET/POST .../cycles/:cycleId/bilateral-applications/:applicationId/residual`
API. The old `PATCH .../settlements/:settlementId` alone confirms,
rejects or cancels the actual cash report using the original
counterparty; the initiator can never confirm their own transfer.

**Atomicity:** group → cycle → sorted original obligations lock;
validate exact two-person source set, live BN-005 balance, applied BN-004
fingerprint, all source versions, no pending existing cash, zero
opposite-direction balance, fixed pair/cycle, current opt-in and
authorization. Only the server selects the full allocation/amount;
never accept client-supplied debtor/creditor, amount, allocations or
status. Insert original `settlements` pending, source allocations,
SC-005 provenance, new immutable BN-006 provenance, existing event and
notification in ONE transaction. Reject/cancel frees the reservation
and may create a NEW attempt; same-key retry returns the original
history. No auto-confirm or bank transfer.

**Security:** POST only if `CI=true` AND
`BN006_TEST_ONLY=isolated-pg17` AND the exact disposable
`postgresql://test:test@localhost:5432/group_expense` URL.
`SETTLEMENT_CYCLE_ENGINE_READY=false` stays unchanged.
Tests verify 122 original sources, noncash conservation, held cash
blocking, direct actor/amount spoofing denied, same-key concurrent
[200,201], double-spend prevention, immutable provenance,
other-party rejection/confirmation, and exact zero residual.

**Contract:** [BN-006-RESIDUAL-CASH.md](./BN-006-RESIDUAL-CASH.md).
**Hard exclusions:** no SC-006 lifecycle/adjustments, no SC-007+,
no shared Neon migration, no staging/production deploy, no merge,
PR #16 remains DRAFT.

## SC-006 — source-safe late adjustments and membership/recurring lifecycle

**DONE ON FEATURE BRANCH; NOT RELEASED.** The original LOCKED cycle is
immutable. Late manual and recurring invoices are existing ORIGINAL
`expenses` and `obligations`, never duplicate expenses or cash.
An owner or explicit active cycle-manager delegate can attach a
previously unrecorded historical invoice once to the chronologically
first later REVIEW cycle, with strict idempotency and immutable SQL
audit `group_settlement_cycle_adjustments`. Original dates and IDs
never change. Target snapshot preview/fingerprint and the
PostgreSQL state-transition guard both include the attributed ORIGINAL
source, while an out-of-period source without audited attribution
remains forbidden. Target locks only after revalidation.

**Hard edit policy:** attribution itself immediately freezes invoice
money/date/item shares/obligations against normal API and direct SQL.
Only original creator may mark the invoice completed when source
debts are confirmed by cash/noncash and no pending cash remains.
No unlocking sealed snapshots, cloning obligation amounts, silent
negative corrections or backdating.

**Recurring:** original daily Vercel Cron runs overdue recurring
generation BEFORE cycle metadata catch-up; incomplete/error/full-cap
batch defers metadata, while `UNIQUE(rule_id,period)` prevents
duplicate monthly bills. All generated original expenses are
eligible for the same late-source attribution logic.

**Membership/archive:** prevent a creator departing with any unfinished
snapshot/attributed/late historical invoice even if monetary balance
is zero; leaving/removal atomically pauses affected active monthly
templates, keeps old occurrences, revokes delegated manager rights.
Group archive refuses open/review periods, unresolved frozen debts or
creator approvals, and unassigned late original invoices. A locked
fully reconciled cycle remains permanently auditable and does not
block archiving by itself.

**Implementation:** migration `021_settlement_cycle_late_adjustments.sql`,
`lib/settlement-cycles/adjustments.ts`, authenticated
`GET/POST .../cycles/:originCycleId/late-adjustments`,
snapshot preview/write and SQL guard updates, recurring Cron ordering,
leave/archive services, matching UI reason, HTTP/SQL and unit tests.
No real financial engine activation, shared Neon migrations,
staging/production deploy or PR merge. **PR #16 remains Draft.**

**Contract:** [SC-006-LIFECYCLE-ADJUSTMENTS.md](./SC-006-LIFECYCLE-ADJUSTMENTS.md).
**Next:** SC-007 full release-safety, concurrency and E2E tests.
Do not start SC-007 in this ticket.

## SC-007 — full financial regression, reproducible races and conservative NO-GO release gate

**DONE on feature branch; financial release remains NO-GO.**

- `tests/sc007-financial-properties.test.mjs`: 1,500 deterministic
  seeded random bilateral scenarios, BigInt exact obligations, FIFO,
  permutation/pair swap metamorphic assertions, equal noncash
  discharge, no fake confirmed cash, pending reservation and 10,000
  source records / 51+ allocations per direction. Forged/overdrawn,
  overflow, cross-pair/group/cycle and stale originals fail closed.
- `tests/sc007-financial-concurrency.integration.mjs`: 16
  independent two-session REAL PostgreSQL 17 races on original
  10,000-VND obligations. Each pair simultaneously attempts
  7,000+7,000: EXACTLY one commit, the other rolls back with
  BN-005 capacity error or PostgreSQL `40P01` deadlock;
  final durable amount is exactly 7,000 pending / 3,000 available.
  Raw SQL cross-group allocation and 3,001-VND overbook after
  7,000 pending also fail with no side effects.
- `db/sc007-audit.mjs`: fail-closed disposable-DB-only,
  REPEATABLE READ READ ONLY independent reconciliation of original
  obligations vs cash/noncash and BN-005 views, exact per-payment
  allocations, BN-004 pair conservation/provenance, BN-006 cash
  history, SC-006 historic source and recurring uniqueness. CI
  runs this BEFORE and AFTER full authenticated HTTP E2E.
- Existing HTTP suite exercises 550+ same-direction cash sources,
  122 opposite-direction immutable noncash sources, real bilateral
  signatures, rejection/revocation/expiry, idempotency and concurrent
  same-key 200/201, distinct-actor consent, source immutability,
  late adjustment, leave/archive, and full balance conservation.
- `tests/sc007-release-safety.test.mjs` verifies real engine is
  hardcoded OFF; all guarded money writes require BOTH CI and
  isolated flag and EXACT localhost disposable PostgreSQL URL.
  The workflow cannot silently flip the production money engine.
- Release-critical bug fixed: SC-006 audited historical late
  invoices were present in target snapshot but BN-001 rejected
  their historic `occurredOn`. `proposals.ts` now proves
  adjustment/target/source-version via PostgreSQL, and BN-001
  only accepts this explicitly proven exception. Original
  invoice date/ID and FIFO remain unchanged. New real
  HTTP test verifies the later locked cycle can preview
  its actual pairwise noncash offset.
- [SC-007-RELEASE-SAFETY.md](./SC-007-RELEASE-SAFETY.md) records
  the precise independent test commands, coverage, verified
  fixture statistics, PASS/NO-GO gate, and remaining roll-out
  prerequisites. **SC-008 UI, SC-009 UX/notification and SC-010
  operational verification are NOT implemented.**

**No real release:** PR #16 is still Draft/unmerged.
`SETTLEMENT_CYCLE_ENGINE_READY=false`, no shared Neon migration,
no staging/production deployment, no actual money enablement.
Do not start SC-008 in this conversation.

## Design debt & migration/release gates

- Existing `lib/debts/service.ts` query limits (500), expense listing (100) and settlement request allocations (50) are UI/API caps, NOT sources for cycle totals. SC-004/SC-005 must use complete indexed SQL.
- Financial adjustments after locked cycle must be new auditable entries, never overwrite the closed snapshot.
- Daily Vercel cron is production-only and Hobby scheduling coarse. SC-003 must be idempotent and support delayed runs.
- Existing `recurring_expense_occurrences` produce regular expenses; SC-006 must make cron ordering deterministic and prevent duplicate inclusion.
- A settlement is not a confirmed cash transfer until the recipient confirms. A set-off is a noncash discharge only after BOTH explicit approvals.
- Unknown/missing rules fail CLOSED. No three-party simplification, cross-currency conversion, credit-balances or automatic bank transfer.
