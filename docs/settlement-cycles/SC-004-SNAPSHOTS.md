# SC-004 — Exact obligation eligibility and immutable settlement-cycle snapshots

> Implemented ONLY on `feat/settlement-cycles-bilateral`. No merge, deploy,
> shared Neon migration or real-money feature activation is authorized.
> A locked snapshot is an AS-OF statement, **not payment confirmation**.

## Boundary and eligibility contract

The source of truth is the original PostgreSQL obligation ledger, not
`listGroupDebts` (500 rows) or `listExpenses` (100 invoices).
A cycle interval is **[period_start,period_end)** of local calendar dates in
its persisted schedule timezone. The corresponding UTC instants remain fixed
by SC-002/SC-003. No UTC day arithmetic may reassign a bill.

Eligible invoices:
- Same `group_id` as the cycle;
- `occurred_on >= period_start AND occurred_on < period_end`;
- `deleted_at IS NULL` and `created_at <= cutoff_at`;
- Any current invoice version, including a self-only or creator-completed
  bill; those with zero payable obligations have a frozen invoice source
  row but no artificially generated debt.

Eligible obligations:
- Same group and eligible source invoice, current non-voided
  `obligations.voided_at IS NULL`;
- Obligation was created before the same cutoff, preserving
  `obligation.expense_version`, debtor and creditor;
- Exact original `bigint` VND; cash allocations counted only through
  `settlement_allocations` joined to `settlements.status`;
- `confirmed_cash` comes ONLY from `confirmed`, `pending_cash`
  comes ONLY from `pending`; `rejected`/`cancelled` count as zero.

Amounts are INTEGER dong / PostgreSQL `numeric(38,0)`, formatted as
strings to clients. This ticket does not introduce set-off amounts:
```
outstanding = original - confirmed_cash
available   = original - confirmed_cash - pending_cash
0 <= confirmed_cash + pending_cash <= original
total = sum(all eligible obligation values), NO UI LIMIT
```
Any negative, contradictory or over-allocated balance is a hard 409/rollback,
NOT silently truncated to 0.

## Review and atomic locking

- SC-003 `open (v1) -> review (v2)` is unchanged.
- SC-004 adds exactly **review (v2) -> locked (v3)**; no transition
  from open directly to locked, no reverse state transition and no
  `settling`, `completed` or bilateral netting yet.
- Manager authorization: session identity and active owner/delegate checks
  INSIDE the group-locked transaction; admins without grants cannot lock.
- Disabling the group blocks NEW snapshot locks but preserves audit/history.
- GET preview is explicit **nonbinding** display and exposes a SHA-256
  fingerprint of deterministic sorted eligible invoice versions, obligations
  and confirmed/pending cash.
- POST locking requires exactly
  `{expectedVersion:2,requestKey:UUID,expectedFingerprint:SHA256}`.
  The server rereads the live ledger inside the write transaction AFTER
  acquiring group+cycle locks, and rejects a changed preview with HTTP 409.
- Persist invoice sources, obligation sources, exact payment categories,
  totals, fingerprint and cutoff; reread the inserted rows and compare
  their hash and sums with the approved fingerprint before sealing.
- Manifest sealing, `locked` state transition and `snapshot_locked`
  audit are ONE PostgreSQL transaction. On any error, all roll back.
- A repeated request key by the same authorized actor for the SAME cycle
  and fingerprint is idempotent, returns the original frozen result.
  Distinct/stale requests fail, even when two managers post concurrently.
- No snapshot or lock is created by Cron. Cron may only move OPEN -> REVIEW.
  No actual payment, set-off or invoice completion is performed by locking.

## Frozen source and late-bill handling

- Frozen snapshot expense/obligation rows, manifest, and audit events
  are immutable with DB-level triggers. After a snapshot is sealed, no
  extra rows may be appended. `UNIQUE(obligation_id)` prevents counting one
  original obligation in two source snapshots.
- A frozen source invoice cannot be edited, deleted, have item/share rows
  changed or have its original obligations voided/replaced. PostgreSQL guards
  protect SQL bypasses; the existing creator API returns controlled HTTP 409.
- **Creator-only invoice completion is still permitted** after all original
  cash obligations have been confirmed and there are no pending payments.
  Group owner/delegate cannot complete someone else's invoice.
- Confirming cash AFTER the lock updates the actual cash ledger as before
  and does NOT retroactively alter the AS-OF snapshot. SC-005+ MUST
  recompute available debt against the LIVE ledger under group locks.
  Never use `snapshot.available_minor` as unconditional permission to
  transfer money later.
- A bill entered or moved into an already locked historical date range
  after its cutoff is detected as a **late adjustment candidate**, excluded
  from frozen totals. Automatic adjustment attribution to a later cycle is
  explicitly deferred to SC-006. It must never silently rewrite history.
- Fully paid obligations remain in snapshot sources for audit (the
  `available_minor` for such a row is zero). Snapshot recording itself
  does not change any original financial balance.

## Schema and API

- Migration: `014_settlement_cycle_obligation_snapshots.sql`.
- Tables:
  `group_settlement_cycle_snapshot_expenses`,
  `group_settlement_cycle_snapshot_obligations`,
  `group_settlement_cycle_snapshots` (manifest).
- DB guards: composite FKs, UNIQUE source identity, money CHECK formulas,
  immutable rows after INSERT, sealed append protection, cross-source
  version/date/balance and manifest sum/count verification before lock.
- `GET /api/groups/:groupId/settlement-cycle/cycles/:cycleId/snapshot`:
  authorized group member receives preview when REVIEW, immutable manifest
  when LOCKED, plus late-invoice count and `financialEngineEnabled:false`.
- `POST` same route: active owner/delegate only; exact reviewed fingerprint,
  idempotency key and expected state version required.
- Mobile manager UI: preview totals, distinction between paid and pending,
  explicit acknowledgment checkbox, separate `lock` button; correct retry.
  This is **not** a cash receipt or debtor approval interface.

## Test acceptance and release boundary

- DB transaction: invoice+obligation source immutable, cash sums equal
  allocation statuses, overpaid/pending inconsistent values rejected;
  DB cannot lock without a complete accurate manifest and source rows;
  zero/fully paid/self-only bills never create fake liabilities.
- HTTP test uses **551 obligations** (more than 100 invoices / 500 debts),
  partial confirmed and pending transfers, stale preview after cash changes,
  two simultaneous owner/delegate lock submissions, idempotent retry,
  late invoice after lock, excluded deleted and end-boundary invoices,
  later confirmed cash, and creator-only completion.
- Migration repeated twice in disposable PostgreSQL CI; no migration is
  applied to Neon development or production. Code remains in Draft PR #16.
- SC-005 covers future batch repayment. SC-006 covers later adjustments and
  membership/archive integration. BN-* tickets cover bilateral noncash offsets.
  **No subsequent ticket is implemented in SC-004.**
