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
| BN-003 | P0 | Dual approval with identities, invalidation/rejection/expiry/revoke, no auto-apply | BN-002 | TODO |
| BN-004 | P0 | Atomic noncash set-off ledger + reservations, exact A↔B balance conservation, immutable audit | BN-003 | TODO |
| BN-005 | P0 | Integrate `confirmed_setoff` into **all** outstanding, available, leave/archive, paid, completion and report queries | BN-004 | TODO |
| BN-006 | P0 | Net residual cash settlement through the pre-existing two-party confirmation flow | BN-005,SC-005 | TODO |
| SC-006 | P0 | Invoice/recurring/member-leave/group-archive integration, unlock/adjustment policy, no retroactive edits | SC-004,BN-005 | TODO |
| SC-007 | P0 | Full financial concurrency, authz, property-based and E2E regression suite; release gate | SC-006,BN-006 | TODO |
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

## Design debt & migration/release gates

- Existing `lib/debts/service.ts` query limits (500), expense listing (100) and settlement request allocations (50) are UI/API caps, NOT sources for cycle totals. SC-004/SC-005 must use complete indexed SQL.
- Financial adjustments after locked cycle must be new auditable entries, never overwrite the closed snapshot.
- Daily Vercel cron is production-only and Hobby scheduling coarse. SC-003 must be idempotent and support delayed runs.
- Existing `recurring_expense_occurrences` produce regular expenses; SC-006 must make cron ordering deterministic and prevent duplicate inclusion.
- A settlement is not a confirmed cash transfer until the recipient confirms. A set-off is a noncash discharge only after BOTH explicit approvals.
- Unknown/missing rules fail CLOSED. No three-party simplification, cross-currency conversion, credit-balances or automatic bank transfer.
