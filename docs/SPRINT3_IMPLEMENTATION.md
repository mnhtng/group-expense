# Sprint 3 — Traceable obligation ledger

Sprint 3 creates a **source-preserving**, directional ledger. A participant's
positive share for an item the payer bought creates debt from participant to payer.
Shares belonging to the payer (or zero-value shares) create **no debt**.

- `obligations`: grouped by debtor/creditor/expense/version, immutable history
  by revision; only `voided_at IS NULL` contributes to live balances.
- `obligation_sources`: permanent per-item snapshots, so historical traces remain
  even when editing an expense deletes/replaces its `expense_items` rows.
- `004_obligation_ledger.sql`: additive schema and one-time backfill of active
  Sprint-2 expenses. Deleted receipts do not become live obligations.
- Expense create/edit/delete writes the obligation ledger within the **same
  database transaction** as the receipt and its event. No partial ledger on failure.
- Expense edits void previous obligations and insert a new expense_version; delete
  voids them. Earlier immutable sources and events remain queryable for audit.
- Zero-debt purchases (payer is sole participant) create no obligations.
- Views: /debts (personal pay/receive per person and group), group debt list,
  obligation detail (each source item), cross-links to original receipt.
- Access: actor must be an active member of the unarchived group. APIs return 401
  anonymously and 404 for nonmembers. No ORM; bigint amounts serialized as strings.
- No settlement/confirmation yet: all current debts are **unpaid obligations**.
  Sprint 4 will introduce pending/confirmed settlements; editing a paid expense
  will need an immutable adjustment workflow instead of simple void+rewrite.
- Shortcuts/netting are intentionally omitted because opposite directional debts
  must retain their traceable original sources.

## Rollout
1. Run migration 004 on isolated PostgreSQL 17 and verify backfill + invariants.
2. Apply to Neon `development` **only** after CI passes and review.
3. Merge feature PR into `develop`, verify Preview deployment and runtime logs.
4. Do not migrate `main` / Neon production until separately approved release.
