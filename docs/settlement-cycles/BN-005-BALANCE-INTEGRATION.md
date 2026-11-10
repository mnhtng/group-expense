# BN-005 — Canonical noncash-aware obligation balances (feature branch, NOT released)

**Only ticket BN-005.** The source of monetary truth remains ORIGINAL
`obligations` plus ordinary two-party confirmed/pending cash and immutable
BN-004 noncash application allocations. No synthetic settlement, second
receivable, new proposal approval, automatic cycle/invoice completion or
new residual-cash workflow. The real financial engine remains OFF.

## Canonical live ledger view

Migration `019_bilateral_setoff_balance_integration.sql` installs
`bn005_obligation_balances` as a normal PostgreSQL read-only VIEW
(not a cached snapshot/materialization) keyed by ORIGINAL obligation ID.

For each obligation, in exact `numeric`/BigInt VND:

```
original              = obligations.amount_minor
confirmed_cash        = SUM(settlement_allocations of status 'confirmed')
pending_cash          = SUM(settlement_allocations of status 'pending')
confirmed_setoff      = SUM(BN-004 applied NONCASH obligation allocations)
pending_setoff        = 0  -- BN-004 has no intermediate persistent reservation
outstanding           = original - confirmed_cash - confirmed_setoff
available             = outstanding - pending_cash - pending_setoff
```

Rejected/cancelled cash is 0 in both confirmed and pending categories.
Creating proposals/signatures is never a financial write. Full signed
and applied BN-004 ledger is independently immutable/auditable.

The view joins applied application records, not proposals, hypothetical
BN-001 calculations, uncommitted approvals or snapshots. Thus there is
NO double charging of an original source, and grouped/per-user money
summaries reflect committed netting even if the group later opts out.
A source outside the original pair or another group cannot enter the
noncash view through application FKs.

## Consumers updated — **same source of truth everywhere**

- `lib/debts/service.ts`: group list, original debt detail, personal
  dashboard, individual open-debt list and FULL-GROUP unpaginated totals.
  Detail now returns immutable setoff provenance separately from ordinary
  cash payment history; cash and noncash fields are distinct.
- `lib/settlements/service.ts`: regular cash settlement creation checks
  original available AFTER confirmed setoff (and pending cash) under
  original group and obligation row locks. An applied source cannot
  be paid again by reporting new cash.
- `lib/settlement-cycles/repayments.ts`: existing one-direction batch
  previews/requests compute their available values and versioned SHA
  from both cash and applied noncash. No BN-006 residual transfer feature
  has been added; the existing cash route is only regression-tested.
- `lib/settlement-cycles/proposals.ts`: pair preview reads live applied
  source values. Reproposal on an already applied pair+cycle is explicitly
  rejected, rather than attempting to republish immutable historical
  source proof.
- `lib/groups/membership.ts`: pending + both-direction outstanding
  checks use the new view, including setoff and consistency fail-closed.
  `lib/groups/service.ts` archive guards also use the exact live
  outstanding sum; no debt gets forgiven because of a snapshot.
- `lib/expenses/service.ts`: list/detail progress, ready-to-close
  ranking and creator-only completion recognize confirmed setoff as an
  actual NONCASH discharge, not cash payment. Inconsistent balances never
  qualify as completion.
- Database `sc004_guard_frozen_expense` updated via
  `CREATE OR REPLACE FUNCTION` in migration 019: a creator may finalize
  frozen original invoices when all ORIGINAL obligations are fully
  discharged by confirmed cash and/or noncash, with no pending cash.
  Other frozen financial edit/delete guards are unchanged.
- Report labels and the original debt/invoice details show **separate**
  amounts for confirmed cash and confirmed noncash; `confirmedMinor`
  represents their combined obligation discharge, not money transferred.
- Group list remains UI-capped (500) and personal item view UI-capped
  (250); financial totals never sum only truncated UI pages.

## SQL safety and locking

Migration 019 adds deferred capacity checks on cash allocations,
settlement state transitions and noncash application allocations.
Cash + noncash confirmed + pending cash may NEVER exceed the original
obligation. Cash writers using ordinary authenticated APIs hold the
group row lock before the original obligations; the SQL constraints
also reject a direct SQL attempt to double spend a discharged source.

A write is NEVER authorized from a frozen settlement-cycle snapshot
balance: the canonical live view is re-read inside write transactions.
All money is integer VND (BigInt in Node, numeric in Postgres). There
is NO floating-point rounding and NO automatic netting across persons.

## Verification / tests

- `pnpm db:migrate` twice on disposable PostgreSQL 17, including 019.
- Full lint, typecheck, native unit tests, Next.js build, all SQL
  regression tests and authenticated HTTP smoke tests.
- HTTP fixture contains 122 ORIGINAL obligations and >50 positive
  BN-004 allocations each direction; confirms exactly `2 × offset`
  total original noncash discharge and per-obligation conservation.
- Group debt API, original debt detail with setoff provenance, personal
  multi-group debt dashboard and invoice progress agree with SQL view.
- Rejects one more dong of ordinary cash on an already fully discharged
  obligation; direct SQL cash bypass fails at transaction COMMIT with
  no extra persisted payment. Original cash histories are not rewritten.
- Creator-only invoice completion works after NONCASH discharge without
  bank transfer, noncreator denied, frozen original remains immutable.
- Exit eligibility and archive actions cannot overlook a positive
  outstanding balance; full-group totals do not rely on UI pagination.
- Existing one-direction cash preview recognizes only post-setoff
  available money. Pending cash reserves but does not discharge; cash
  cancellation restores availability; confirmation changes CASH only,
  leaving prior noncash audit unchanged.
- Legacy non-opted-in group/payment regression tests remain unchanged.

## Release gate, strict non-scope

`SETTLEMENT_CYCLE_ENGINE_READY=false` remains unchanged. BN-004
application POST remains writable only under ALL disposable runner
conditions `CI=true`, `BN004_TEST_ONLY=isolated-pg17`, exact local
`postgresql://test:test@localhost:5432/group_expense` DB URL.

No shared Neon migration, staging/production deployment, PR merge,
BN-006 residual-cash flow, SC-006 late-bill adjustments, automation,
notifications, full mobile UI, or authorization expansion. PR #16
remains **Draft**, targeting `develop`. The next ticket, BN-006, must
be handled separately after BN-005 verification and an explicit request.
