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
| SC-002 | P0 | Cycle configuration: timezone/anchor/frequency/ranges, versioning, safe future-only changes | SC-001 | TODO |
| SC-003 | P0 | Cycle state machine / immutable cycle identity + overlap prevention + manual/cron transitions | SC-002 | TODO |
| SC-004 | P0 | Eligible obligation snapshots: date boundary, cash confirmed/pending, late bills, frozen versions, canonical SQL | SC-003 | TODO |
| SC-005 | P0 | Same-direction batch repayment by pair, 50+ allocations, idempotent requests and scoped confirmation | SC-004 | TODO |
| BN-001 | P0 | Pairwise bilateral calculator (pure BigInt) + deterministic allocation and eligibility rules | SC-004 | TODO |
| BN-002 | P0 | Bilateral proposal persistence, one group+cycle+pair+version, stable fingerprint and conflict handling | BN-001 | TODO |
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

## Design debt & migration/release gates

- Existing `lib/debts/service.ts` query limits (500), expense listing (100) and settlement request allocations (50) are UI/API caps, NOT sources for cycle totals. SC-004/SC-005 must use complete indexed SQL.
- Financial adjustments after locked cycle must be new auditable entries, never overwrite the closed snapshot.
- Daily Vercel cron is production-only and Hobby scheduling coarse. SC-003 must be idempotent and support delayed runs.
- Existing `recurring_expense_occurrences` produce regular expenses; SC-006 must make cron ordering deterministic and prevent duplicate inclusion.
- A settlement is not a confirmed cash transfer until the recipient confirms. A set-off is a noncash discharge only after BOTH explicit approvals.
- Unknown/missing rules fail CLOSED. No three-party simplification, cross-currency conversion, credit-balances or automatic bank transfer.
