# RR-001 — Isolated Neon 011–023 migration rehearsal evidence

**Date:** 2026-11-05  
**Source code SHA (pre-evidence):** `07e27652d4f57f0bafd378ec4338cf79c696b974`  
**State:** MIGRATION / CHECKSUM / EXISTING-SOURCE INTEGRITY **PASS**; financial release **NO-GO**.  
**PR:** #16 must remain **Draft** against `develop`.

## Strict environment scope

| Resource | Neon ID | Action |
|---|---|---|
| Project `group-expense` | `withered-salad-00928018` | Scope verified |
| **Test child `sc010-rehearsal-20261105`** | **`br-curly-rice-b3xenws6`** | **Only branch migrated** |
| Parent `development` | `br-dry-poetry-b31cudmb` | Read-only verification, not migrated |
| `production` | `br-round-salad-b39y4yce` | Read-only verification, not migrated |
| Database | `group_expense` | Explicitly pinned on every Neon call |

The child was verified as a ready child of the development branch with an empty baseline schema diff before applying migrations. No connection credentials are stored in repository or evidence.

## Execution performed — **on child only**

1. Confirmed pre-state: child and development **10** schema migrations through `010_monthly_recurring_expenses.sql`; production **6** through `006_notifications.sql`.
2. Read-only PostgreSQL SHA-256 of complete **original `expenses` and `obligations` rows** was captured before any child migration.
3. Fetched exact SQL migration files `011`–`023` at pinned GitHub commit SHA.
4. Executed all **13 migrations in ascending order** on child, using the Neon connector and SQL statements split on top-level semicolons (respecting PostgreSQL function dollar quotes). **Each file was committed in its own PostgreSQL transaction** protected by `pg_advisory_xact_lock(240011,2026)` and an exact previous-migration count check. Added `schema_migrations.filename` and SHA-256 over the exact original file bytes via built-in PostgreSQL `sha256(convert_to(text, 'UTF8'))` in that same transaction. No ORM and no app-side finance APIs.
5. Verified **23/23 installed migration SHA-256 hashes** against the corresponding GitHub SQL files (001–023), in read-only transactions. This proves the regular `db/migrate.mjs` version/checksum skip path is idempotent **at the current state**. The actual `pnpm db:migrate` CLI was not invoked against Neon (the authenticated connector executed the equivalent SQL); no claim otherwise.
6. Independently reran all **8** original SC-007 financial cross-table reconciliation queries in a `REPEATABLE READ READ ONLY` transaction. Every check returned **0 violations**.
7. Confirmed child SHA-256 of full original `expenses` and `obligations` rows was **byte-for-byte identical before and after**, with 2 original expenses and 2 original obligations.
8. Confirmed parent still has **10** migrations and production **6**; their original row SHA-256 snapshots remained unchanged. Child-vs-parent Neon schema diff is now **nonempty by design**, reflecting the new feature DDL.
9. Inspected feature schema objects. `bn005_obligation_balances` contains 2 valid source rows; no negative live balance. `group_settlement_bilateral_applications`, `settlement_cycle_operational_runs` and `group_settlement_cycle_disputes` exist. Observed 6 non-internal `bn004_%` triggers and 13 `sc009_%` triggers. The original CASH and NONCASH ledgers received **no new records** from this migration.
10. Preserved financial kill switch `SETTLEMENT_CYCLE_ENGINE_READY=false`, PR #16 Draft and unmerged; **no staging/production migration, deployment, feature activation, runtime bank-transfer or ledger write**.

## Read-only financial verification

All checks are the exact SC-007 independent queries sourced from `db/sc007-audit.mjs`, executed against the isolated Neon child **without the CI-only script's disposable-localhost bypass**:

| Check | Violations |
|---|---:|
| exact_live_balance_independent_ledger | 0 |
| exact_cash_allocations_equal_settlement | 0 |
| bn004_pair_conservation_and_source_identity | 0 |
| bn004_source_exact_original_allocation | 0 |
| bn006_cash_provenance_and_no_fake_discharge | 0 |
| sc006_historic_source_single_orig_attribution | 0 |
| snapshot_original_obligation_unique_source | 0 |
| recurring_rule_period_unique | 0 |

Original full-row SHA-256 proofs (public evidence hashes, **not original records**):
- `obligations`: `fce8e9d16d94b5dbf290599e4540ed0a825baf277aa2608760f15342fecf6e4b`
- `expenses`: `2ebe211c1b642a89fd3b4e9b2f2999e432dfb2c3d87485a248836a851965f4a7`

## Limits of the evidence

**Do not confuse a schema migration pass with a full managed recovery or functional release pass.**

- This isolated database has **zero** bilateral noncash applications, locked snapshots, disputes or operational Cron runs. Checks over these sources are vacuously clean; the high-volume real signed HTTP E2E and applied setoff evidence come from **disposable PostgreSQL 17 CI** under SC-007/SC-010, **not** this Neon test branch.
- Original user authorization and party privacy were exercised by the isolated CI/HTTP suites, not by an authenticated Neon preview deployment. RR-002 browser/PWA E2E and a separately approved staging rehearsal remain pending.
- No Neon PITR/managed backup restore was executed. This is tracked by RR-003, and production RPO/RTO remains unverified.
- A full CLI `pnpm db:migrate` execution twice on a branch-specific URL was **not** run; instead the same SQL files and checksum logic were used through the Neon connector, with complete 23-file read-only re-verification. Do not claim an actual CLI double-run.
- Shared Neon development/production were not changed. The child is preserved for possible future independent testing and must not be deleted without approval.
- The financial feature engine is **OFF** and the release verdict is **NO-GO** pending RR-002–RR-005 and independent signoff.

## References

- [RR-001–RR-005 backlog](./BACKLOG.md)
- [SC-010 operational runbook](../settlement-cycles/SC-010-OPERATIONS-ROLLOUT.md)
- [Financial invariants](../settlement-cycles/DOMAIN_RULES.md)
- [Read-only original financial auditor](../../db/sc007-audit.mjs)
- [Neon identity preflight tool](../../db/rr001-neon-preflight.mjs)
