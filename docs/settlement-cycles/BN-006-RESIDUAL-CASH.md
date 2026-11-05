# BN-006 — Net residual cash after a committed bilateral set-off

> Ticket BN-006 only, implemented on `feat/settlement-cycles-bilateral`.
> **NOT RELEASED.** The financial engine remains disabled in all real
> environments. No migrations have been run against shared Neon.

## Purpose and accounting boundaries

BN-004 is an immutable two-direction **NONCASH** obligation discharge.
BN-005 makes every original debt balance account for confirmed setoff.
BN-006 creates ONE explicitly initiated, ordinary **CASH** payment
request ONLY for the live residual of that **already applied**
noncash proof. The request is `pending` until the original *other
counterparty* confirms the transfer through the PRE-EXISTING bilateral
`PATCH /api/groups/:groupId/settlements/:settlementId` endpoint.

No fictional transfer, no automatic confirmation, no 3rd party, no
cross-group/cross-cycle amount, no additional setoff, no changing the
original invoice, obligation, SC-004 snapshot or BN-004 audit document.

### Example

- B originally owes A 190,000 VND; A owes B 140,000 VND.
- Both separately approve BN-004 noncash offset: 140,000 VND each way.
- BN-005 live source balances are 50,000 VND B→A; zero A→B.
- BN-006 previews 50,000 VND for B→A. It creates exactly one
  `settlements(status='pending')` with full ORIGINAL-obligation
  allocations and immutable link to the BN-004 application.
- A or B may INITIATE the request, but ONLY its actual other
  counterparty can confirm or reject. Confirmation settles 50,000;
  pending does not. Rejected/cancelled cash releases availability
  and another uniquely keyed request can be issued.
- If no money remains, NO zero-amount payment is created.

For ordinary cash confirmed *before* residual creation, the live
amount (not the old BN-002 source estimate) is recomputed. Existing
pending cash in either direction prevents a BN-006 request until
resolved. If both directions remain outstanding after cancellation,
the system FAILS CLOSED and does not invent another multilateral
or repeated offset (SC-006 handles later adjustments).

## Persistence — migration 020

`020_bilateral_residual_cash_repayments.sql` creates
`group_settlement_bilateral_residual_repayments`:

- `settlement_id` is both the PRIMARY KEY and FK to the ORIGINAL
  SC-005 `group_settlement_cycle_repayments` provenance.
- `application_id` references an *actually applied* BN-004
  two-party NONCASH application, never a proposal or signature.
- `group_id,cycle_id,debtor_id,creditor_id,initiated_by` are
  authenticated, immutable and validated against the true original
  cash settlement, locked snapshot, exact applied pair and active
  counterparties.
- `preview_fingerprint` binds full live original source IDs, versions,
  original amount, actual cash confirmed/pending and applied setoff
  to the specific BN-004 proof; `request_digest` binds identity,
  immutable client expectation and normalized note to idempotency.
- `amount_minor` is bigint VND; `allocation_count` exact and
  bounded. SQL verification validates equality of all original source
  allocations to the due residual and zero in the opposite direction.
- Group row is locked, and a pending cash request must be precisely the
  one new settlement: no older pending cash can be hidden or counted as
  paid. A source outside the original cycle/pair is forbidden.
- SQL audit trigger prevents UPDATE or DELETE of residual provenance.
  Existing SC-005 locks protect original settlement and allocation
  identity; only the ordinary two-person pending→confirmed/rejected/
  cancelled state change is allowed. All writes commit in ONE transaction.

Rejected and cancelled cash attempts remain as immutable historical
records and may have a new, separately keyed retry. This is important:
UNIQUE(application_id) alone would incorrectly prevent retry, so the
schema has one unique row PER CASH settlement, not per application.

## API, security, transaction and failure policy

```
GET  /api/groups/:groupId/settlement-cycle/cycles/:cycleId/bilateral-applications/:applicationId/residual

POST /api/groups/:groupId/settlement-cycle/cycles/:cycleId/bilateral-applications/:applicationId/residual
{
  "expectedCycleVersion": 3,
  "requestKey": "<UUID>",
  "expectedFingerprint": "<SHA256>",
  "note": "optional, <=500 chars"
}
```

No client-supplied amount, actor, debtor, creditor, allocations,
payment status, confirmation or bank-transfer result is accepted.

- GET: original two active members only; complete original-source
  recomputation on the locked snapshot, `ready` / `blocked` /
  `settled` preview, amounts in exact VND strings, pending cash,
  immutable previous attempts and no real financial release flag.
- POST: original two active members only. Group FOR UPDATE →
  original locked cycle → original obligations FOR UPDATE sorted by
  source ID. Re-check current setting opt-in, both current members,
  exact applied BN-004 document/snapshot, ALL BN-005 balances and
  all source/fingerprint/availability invariants. NO user-supplied
  monetary amount. Full one-direction remaining amount or nothing.
- Same actor + same UUID + exactly same request digest replays the
  original cash settlement ID (HTTP 200), including if its status is
  already resolved or group later opted out. New creation is HTTP 201.
  Different request with reused key, a second pending attempt or a
  stale original-source fingerprint returns HTTP 409.
- Ordinary cash `settlements`, exact `settlement_allocations`,
  SC-005 provenance, BN-006 immutable link, existing `settlement_events`
  and in-app `notifySettlement` are ALL inserted atomically.
  Existing push worker only delivers the original cash notification.
- A request is NEVER auto-confirmed. Confirmation/rejection/cancel uses
  the same `PATCH .../settlements/:settlementId` rules; the initiator
  may not confirm their own request, regardless of whether the initiator
  is debtor or creditor.

### Strict CI-only gate

```text
CI=true
BN006_TEST_ONLY=isolated-pg17
DATABASE_URL=postgresql://test:test@localhost:5432/group_expense
```

All THREE are necessary for a NEW residual cash request. There is NO
production, Neon, staging or generic environment override.
`SETTLEMENT_CYCLE_ENGINE_READY=false` is NOT modified.

## Acceptance and verification

- CI: all source lint, TypeScript, unit and production build tests pass.
- Disposable PG17: migrations 001–020 twice, full SQL integration and
  Better Auth authenticated HTTP workflow.
- Real fixture: original 122 source obligations, two-sided BN-004
  application, BN-005 confirmed noncash and pre-existing partial cash.
- Negative: unauthenticated/third party denied, forged amount/actor
  fields denied, stale fingerprint/version denied, pending third-party
  cash blocks request; no ability to self-confirm.
- Concurrency: same-key parallel 201/200 points to ONE durable
  cash settlement, extra request while pending is rejected.
- Rejection: retains original BN-004 ledger; releases pending balance,
  then another separately keyed cash request succeeds.
- Counterparty confirmation: final residual outstanding reaches zero;
  duplicate zero-amount transfer forbidden, original noncash allocation
  count and SQL conservation unchanged.
- Direct SQL immutability: BN-006 provenance cannot UPDATE or DELETE.
  Existing SC-005 and BN-005 SQL guards remain active for allocations
  and overdraw.

Verified final BN-006 implementation run (before docs-only commit):
[CI](https://github.com/mnhtng/group-expense/actions/runs/41977899879)
and
[PostgreSQL 17 / HTTP](https://github.com/mnhtng/group-expense/actions/runs/41977899998).

## Explicit non-scope

- BN-007 does not exist; do not invent further BN tickets.
- SC-006 late-invoice adjustment / broad group lifecycle policy,
  SC-007 broader release E2E/property tests, SC-008 mobile UI,
  SC-009 notification extensions or automated cycle completion.
- Automatic money transfer or bank confirmation, real-money release,
  migration on shared Neon, staging/production deploy or merge.
- PR #16 remains **Draft**, targeting `develop` and unmerged.
