# Financial invariants & lifecycle contract — settlement cycles / bilateral set-off

**Purpose:** immutable engineering constraints to reload before every future ticket in the backlog. Only a specification: features are NOT fully implemented merely because a document exists.

## Ledger identities

- A group has one currency (existing groups are VND-only). Obligations belong to an original invoice, debtor, creditor and its immutable version.
- A cycle is an attribution/snapshot of eligible obligations, NOT a new expense. One obligation can be sourced from one cycle; unpaid balances may be *shown* as carried forward without cloning the original obligation.
- Settlements are cash acknowledgements; status `pending` does not discharge any debt.
- A bilateral set-off is **noncash discharge** of equal amounts against strictly opposite obligations of the same pair, never across other group members.
- `confirmed_setoff(A->B) == confirmed_setoff(B->A)` for one applied document.
- `outstanding_o = original_o - confirmed_cash_o - confirmed_setoff_o >= 0`.
- `available_o = outstanding_o - pending_cash_reserved_o - pending_setoff_reserved_o >= 0`.
- No entry can allocate more than an obligation's available balance; allocations must sum exactly to source/discharge total (integer VND).
- Every cash transfer and set-off has separate provenance and states. Never render a set-off as a bank transfer, and never erase original invoices.
- Applying set-off is a single atomic Postgres transaction; both directions and the immutable document commit or both roll back.
- The invoice creator alone can edit/finalize a qualifying invoice even when a delegate manages cycles.
- All group-membership/role checks happen **inside** a write transaction after locking the group, not just at client render or a preflight GET.

## Pairwise algorithm eligibility

Given pair `A != B`, group G, settled-cycle scope C:
1. Read only active non-void obligations, in VND, belonging to G/C and whose debtor/creditor are exactly A and B, excluding unconfirmed or disputed allocations.
2. Group by direction, summing eligible available outstanding with `bigint` / SQL numeric.
3. `offset = min(A_owes_B, B_owes_A)`. If either direction zero, no set-off is offered.
4. Assign equal offset allocations to original opposite-direction obligations using stable deterministic sort (date, obligation ID); keep original links.
5. Proposal fingerprint binds IDs, versions, eligible amounts, C's snapshot ID, and both signatories. Stale data invalidates approvals.
6. Require A and B's *separate* affirmative approvals to the same fingerprint. No admin or cycle manager substitute.
7. Re-check eligibility and balance while locking group -> cycle -> sorted obligations -> proposal. Reject if changed; do not auto-reprice after approval.
8. Apply immutable noncash offsets on both directions; only the net residual may be collected through existing cash settlement with its own dual confirmation.
9. Do not allow automatic multi-party debt simplification, cross-group netting, or cross-period offsets without explicitly designed future rules.

## Lifecycle and temporal boundaries

- Groups not opted in are unaffected. Owner/delegate setup and effective runtime availability are separate; release flag remains disabled until safe engine readiness.
- Cycle dates are `[start,end)` in group timezone (default Asia/Ho_Chi_Minh), UI uses `d/m/yyyy`, storage retains date/timestamp standards.
- Review/lock must not silently consume a pending transfer. Late invoices -> auditable adjustment in next unlocked cycle, not a mutation of frozen history.
- Owner and authorized active delegates can manage cycles; only owner can grant/revoke delegates. Transfer ownership revokes previous delegations; leaving group revokes delegated access and rejoining never restores it.
- Do not mark a cycle fully completed while cash confirmations, set-off proposals, debt balances, or invoice creator approvals are unfinished.
- Recurring monthly invoices flow through normal expense ledger and are attributed by their actual occurrence, never duplicated as a second expense.
- Cron is at-least-once-like; use unique keys, transaction idempotency, catch-up and explicit monitoring.

## Test catalog for later tickets

- Exact zero, two-direction imbalance, both equal, 10,000 invoices, 51+ allocations.
- One vs many pair memberships; groups/currencies/cycles excluded correctly; no third-party re-routing.
- Cash paid before set-off, unconfirmed cash, partial cash, partial set-off, simultaneous cash/offset, cancel/reject/timeouts.
- Two approvals to different revisions, duplicate approval, one approval then debt changes, role revoked mid-request, group archived mid-request.
- Concurrency: double-click, two workers, two owners/delegates, deadlock retry, partial transaction rollback, state after lost HTTP response.
- Leave/rejoin, ownership transfer, blocked archive, scheduled invoice catch-up, zero obligations, creator departed before closing.
- No loss of audit, totals conserved, history reads correctly, UI excludes nonpayable/voided obligations.
- Negative SQL/database tests must assert CHECK/UNIQUE/FK constraints and that denied actions leave ledger byte-for-byte unchanged.

## Operational gates

- Run migration tests on an **isolated Neon test branch**, not the shared development/production branch; do not deploy unfinished cycle functionality.
- When all P0 implementation and tests pass, perform a separate staged rollout, reconciled sample balances and production backup before allowing real money.
- Do not use ORMs, binary floating point, or UI-only authorization. Follow existing node-postgres (`pg`) SQL migration flow.
