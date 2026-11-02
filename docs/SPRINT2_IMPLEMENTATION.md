# Sprint 2 — Itemized expenses (2026-11-03)

## Supported functionality
- Create an expense with 1–50 line items, quantity, integer VND unit price, payer,
  participants per item, and either exact/manual shares or deterministic equal splits.
- View expense lists/details and member-level allocations.
- Edit as creator or group owner/admin, protected with version checks (HTTP 409).
- Soft delete, preserve versioned immutable JSON snapshots in `expense_events`.
- All financial writes use PostgreSQL transactions and explicit parameterized SQL via
  `pg`. No ORM. Authentication uses Better Auth sessions from Sprint 1.
- Unauthorized users receive HTTP 401/404. Shares/payers must belong to the group.
- Indexes and foreign keys guard group relations, money fields and item quantities.

## Migration
`db/migrations/003_expenses.sql` is additive and must be applied to Neon **development**
after CI passes, **never to production during feature review**.
Use `DATABASE_URL_DIRECT` for production-style migration runners.
CI uses a disposable PostgreSQL 17 server and migrates 001→002→003 twice.
Beware: update replaces item IDs, while revision events preserve all prior item
allocations as snapshots. The obligations ledger is deliberately deferred to Sprint 3.

## Acceptance gates
- Unit: exact VND splits, deterministic rounding, manual amounts, bounds and invalid members.
- Integration: migration idempotency and referential integrity.
- HTTP: anonymous rejection, authenticated create/list/detail/update/delete, 409 stale version,
  invalid share rejection and immutable event snapshots.
- UI: mobile editor, multiple item rows, payer, per-item members, total and details.
- No schema modifications to Neon production or auto-merge to `main`.

## Future constraints
Prior to enabling Sprint 3 settlements, restrict expense mutation for confirmed
settlements, use immutable reversals, and guard allocation links against deletion.
Manual expense modification is currently permitted only before such a ledger exists.
