# SC-005 — Pair-scoped, same-direction batch cash repayments

> **One ticket only.** New behavior remains financially **unreleased**.
> `SETTLEMENT_CYCLE_ENGINE_READY=false` is unchanged; this does not
> authorize transferring actual cash on staging/production.

## Exact domain scope

A batch is ONE ordinary `settlements` record of status `pending`, with
one or more `settlement_allocations` to ORIGINAL obligations. It has ONE
`group_id`, ONE immutable LOCKED `cycle_id`, ONE debtor and ONE creditor
and ONE currency (existing groups are VND-only). A direction A→B and B→A
are **distinct**; no third party can enter either settlement, no multilateral
debt simplification and NO two-way noncash set-off in this ticket.

A batch reuses existing bilateral cash confirmation. It is **NOT** a
completed receipt merely because it was created: status `pending`
reserves availability but does not reduce outstanding debt.
Exactly the other counterparty can `confirm` or `reject`; the initiator
can `cancel`. Actions remain under the same original
`/api/groups/:groupId/settlements/:settlementId` endpoint and audit feed.

**Scope source:** `group_settlement_cycle_snapshot_obligations` joined to
the ORIGINAL nonvoid, nondeleted `obligations` / `expenses`, tied
to the exact frozen cycle and pair by composite IDs. Late invoices that
missed the snapshot are NOT imported. No backdating or cross-cycle cash
allocations can be inserted through SC-005.

## Live money rules

Never authorize from old snapshot amounts: snapshots are immutable AS-OF
historical evidence. Every pair preview uses the live settlement ledger:

```
confirmed_cash_o = SUM(allocations WHERE settlement.status='confirmed')
pending_cash_o   = SUM(allocations WHERE settlement.status='pending')
outstanding_o    = original_o - confirmed_cash_o
available_o      = outstanding_o - pending_cash_o
batch_amount     = SUM(available_o > 0 within ONE debtor->creditor pair)
```

- `rejected` or `cancelled` cash contributes ZERO to both sums.
- Invalid negative or over-allocated live source is HTTP 409, never
  silently clamped or rounded.
- Integer VND only: exact BigInt arithmetic, SQL `bigint/numeric` and
  string serialization. Total must fit one Postgres `bigint`.
- A request includes ALL currently available amounts on each eligible
  source obligation for that specific direction. No UI list limit
  (100/500) and no 50-allocation restriction. A protective maximum of
  20,000 allocations per batch prevents memory/DB exhaustion.
- Deterministic ordering by obligation UUID, one preview SHA-256 fingerprint
  bound to cycle, pair, source obligation IDs, expense version, original
  amounts, confirmed cash, pending cash and current available cash.
  Zero-available sources also participate in the fingerprint, making
  status changes observable.
- A settlement request fingerprint additionally binds preview
  fingerprint, cycle, pair, version and note. A reused key with any
  modified content is HTTP 409.

## Authorization and transaction integrity

- Only an ACTIVE group member who is **the actual debtor or creditor** may
  submit a new pair batch. Group owner, admin or cycle manager status is
  NOT enough to impersonate either counterparty.
- Both debtor and creditor must currently be active group members when
  creating the request. Group must not be archived, must have
  `requested_enabled=true`, and cycle must be LOCKED version 3 with
  its immutable snapshot manifest present.
- Lock order: `groups FOR UPDATE` → locked cycle →
  selected original obligations `ORDER BY obligation.id FOR UPDATE`.
  Existing manual payments and their resolutions also use group lock
  first, preventing balance races, double reservations and deadlocks.
- POST re-queries the actual live ledger INSIDE the locked transaction.
  If any invoice, confirmed cash, pending reservation or source version
  changes after preview, the fingerprint mismatch yields HTTP 409.
- Creation commits exactly one `settlements` row,
  `settlement_allocations` for every eligible source, one immutable
  `group_settlement_cycle_repayments` provenance row, existing
  `settlement_events(created)`, and the existing in-app notification
  in ONE transaction. Any error rolls all of it back.
- Allocations use typed `UNNEST(uuid[],bigint[])`, avoiding parameter
  count overflow for >50 and >500 source obligations.
- PostgreSQL trigger cross-validates actor, pair, locked cycle, snapshot
  sources, nonvoid original obligations, exact row count and sum.
  More triggers make batch allocation membership, cash identity,
  provenance and audit immutable after insert. Only the existing pending
  → confirmed/rejected/cancelled two-party transition is legal.
- Same `(group_id, initiated_by,request_key)` retries after committed
  success return its ORIGINAL settlement ID, even if its status has
  since changed or the group disabled future cycle processing.
  A new request while disabled is rejected. Rejection/cancellation
  releases the live reservation, and a NEW request key may cover only
  the newly available balance.

## HTTP API

`GET /api/groups/:groupId/settlement-cycle/cycles/:cycleId/repayments`

Returns `{pairs,enabled,scope:"one_cycle_one_direction"}` for any active
group member. Each `pairs[]` item has
`{debtorId,creditorId,allocationCount,availableMinor,pendingMinor,fingerprint}`.
Only directions with positive available money are returned.

`POST` to the same endpoint requires JSON:
```json
{
  "expectedCycleVersion": 3,
  "requestKey": "8c134b5d-3450-4b3d-af2a-e2892ab51242",
  "debtorId": "debtor-user-id",
  "creditorId": "creditor-user-id",
  "expectedFingerprint": "<64 lowercase sha256 hex>",
  "note": "Tiền ăn trong tuần"
}
```
`note` is optional, maximum 500 characters. Unknown fields, malformed JSON
and invalid IDs are rejected; idempotent retry returns 200, first creation 201.
`GET` returns `enabled:false` for a group that opted out or for the
not-yet-released global finance engine. The server never trusts
client-supplied allocations, amount, approver or settlement status.

**After the POST** the counterparties use the EXISTING authenticated
`PATCH /api/groups/:groupId/settlements/:settlementId`
with `{action:"confirm"|"reject"|"cancel"}`.
Cash changes to `confirmed` only on successful confirmation by the
real other counterparty. A group manager cannot replace that person.

## Release gate and CI-only execution

The SC-001 global `SETTLEMENT_CYCLE_ENGINE_READY` stays FALSE. All newly
scoped financial writes return HTTP 409 in ordinary runtime, staging,
production and normal local developer databases. This ticket does not
enable actual cycle finance.

To test the entire HTTP creation/confirmation path WITHOUT relaxing this
production gate, a **strict internal fixture-only exception** is allowed
when ALL three server conditions match the disposable GitHub workflow:
- `CI=true`
- `SC005_TEST_ONLY=isolated-pg17`
- `DATABASE_URL=postgresql://test:test@localhost:5432/group_expense`

The CI workflow creates/destroys a PostgreSQL 17 service and never uses
Neon shared branches. A Vercel deployment cannot satisfy the exact local
test-only database URL. The flag is not client-configurable or a public
feature toggle, and must be removed or replaced by explicit audited
production release controls during SC-007/SC-010.

## Tests and prohibitions

HTTP integration verifies 550 allocations from frozen real invoices; one
old `pending` partial payment changes the fingerprint and reduces live
available; two concurrent requests produce [201,409]; two identical-key
requests produce [201,200] with the same ID; retries/different payloads,
refusals, cancellations, unexpected approvers, crossed pair, wrong
cycle, zero remaining availability, and disabled mode all fail safely.
Direct SQL tests reject association with nonexistent snapshots, mutated
allocation rows, altered transaction amount, early self-confirmation,
mutable provenance and deleted audit history.

**Explicitly excluded:** bilateral offset proposal or application (BN-*),
future-cycle late-bill attribution (SC-006), full mobile UI/redesign
(SC-008), automatic confirmation, group settlement completion or live
finance activation. No merge, deployment, production migration or
financial engine enablement is authorized under SC-005.
