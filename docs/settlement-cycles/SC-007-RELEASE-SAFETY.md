# SC-007 — Financial safety regression, concurrency and release gate

> **IMPLEMENTED ON DRAFT FEATURE BRANCH ONLY — RELEASE DECISION: NO-GO**
>
> `feat/settlement-cycles-bilateral` → Draft PR #16 → `develop`.
> All new cycle/cash/noncash operations remain disabled in real environments.
> `SETTLEMENT_CYCLE_ENGINE_READY=false` MUST stay unchanged.
> Do not migrate shared Neon, deploy, merge or release actual money.

## Why this ticket exists

The SC-001…SC-006 and BN-001…BN-006 work is the isolated implementation.
SC-007 is **verification and an explicit conservative release gate**,
NOT another product feature, automatic money transfer, new cross-person
netting, new ledger entry or permission expansion. A passing isolated
test suite alone never authorizes real financial execution.

## Test architecture and commands

CI has two mandatory checks on the feature branch:

1. `CI`: ESLint, `next typegen` + TypeScript, Node native
   property/unit tests and production Next.js build.
2. `Sprint 1 Integration`: ephemeral PostgreSQL 17
   `postgresql://test:test@localhost:5432/group_expense`, migration
   001–021 TWICE for integrity/hash/idempotency, all SQL integration
   tests, SC-007 read-only independent reconciliation, Next.js
   production build, authenticated HTTP E2E and a SECOND independent
   reconciliation after all real HTTP activity.

Run only on an isolated disposable PostgreSQL instance:

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm db:migrate
pnpm db:migrate
pnpm test:integration
CI=true SC007_TEST_ONLY=isolated-pg17 \
 DATABASE_URL=postgresql://test:test@localhost:5432/group_expense \
 pnpm test:finance:audit
pnpm build
pnpm test:http
CI=true SC007_TEST_ONLY=isolated-pg17 \
 DATABASE_URL=postgresql://test:test@localhost:5432/group_expense \
 pnpm test:finance:audit
```

**Never copy the test-only cash flags or local CI database credentials
into real environments.** HTTP integration requires its own local
Better Auth secret, localhost URL and the three existing
`SC005_TEST_ONLY`, `BN004_TEST_ONLY`, `BN006_TEST_ONLY`
CI fixture flags. The financial-engine release flag itself remains OFF.

### Verification matrix

| Domain | Evidence | Checked invariant |
| --- | --- | --- |
| Pure BigInt model | `tests/sc007-financial-properties.test.mjs` | 1,500 seeded random configurations, independent model, equal two-direction noncash offset, FIFO/permutation invariance, pending cash never paid, exact cash+setoff conservation, no source mutation |
| Stress | Same model suite | 10,000 ORIGINAL source records; 51+ allocations each direction; aggregate exceeding JS safe-integer range; no floating-point amounts |
| Security input | Same suite | Negative, fractional, overbooked, overflow, duplicate, third-party, cross-cycle/group, stale and voided sources denied |
| DB money concurrency | `tests/sc007-financial-concurrency.integration.mjs` | 16 independent simultaneous two-connection attempts to reserve 7,000 + 7,000 against a 10,000 VND obligation; exactly ONE COMMIT per source and 16 durable rollback losers |
| Direct SQL bypass | Same integration suite | PostgreSQL composite FK denies cross-group allocations; a further 3,001 VND after 7,000 pending is rejected at COMMIT; audit still has exactly 7,000 reserved and 3,000 available |
| Existing approvals/noncash | `tests/preview-http.smoke.mjs` and BN-001…BN-006 suites | Separate exact two-party approval, original-source noncash immutable history, 122 original pair obligations, atomic per-direction conservation; no fake CASH |
| Real cash E2E | Same authenticated HTTP suite | 550+ source repayment allocations; original recipient-only confirmation, pending/cancel/reject/retry, same-key concurrent 201/200, stale source, double spend and wrong identity denied |
| Late source E2E | SC-006 + SC-007 HTTP fixture | Locked old period → unrecorded original late bill → one audited next REVIEW target → locked target without duplicate source → new BN-002 noncash preview recognizes audited late source |
| Leave/archive | Same HTTP suite | Creator-only invoice completion, zero-debt creator cannot leave before finalizing source; monthly template paused when member leaves; unresolved cycle/archive blocked |
| Independent pre/post ledger | `db/sc007-audit.mjs` | Eight standalone SQL reconciliation queries against original obligations, cash allocations and statuses, BN-004 applied noncash allocations, BN-006 cash provenance, SC-006 unique late attribution, immutable snapshot source uniqueness and monthly occurrence uniqueness |
| Fail-closed runtime | `tests/sc007-release-safety.test.mjs` | Never accept arbitrary env flag to enable financial engine; require exact disposable database and CI flags; no background real cash confirmation; session-derived actor identity and audit-proven SC-006 source |

### Reconciliation sample (disposable runner, after HTTP)

- Original obligations: **704**
- Ordinary cash settlement records: **40**
- Applied BN-004 noncash documents: **1**
- Immutable snapshot source obligations: **676**
- SC-006 late adjustment records: **1**
- Eight independent cross-table invariants: **0 violations**

These are fixture counts, not real-user balances and not a guarantee
of correctness on any shared database. In the SQL concurrent race,
one writer sometimes loses with PostgreSQL `40P01` (deadlock),
rather than the BN-005 capacity exception. Both are safe
transaction rollbacks, not successful payments. Existing application
writers acquire the **group lock first** and should treat any
unexpected `40P01/40001` as failed and re-read the source before a
bounded retry. SC-007 explicitly verifies the final persisted balance
rather than requiring a particular loser exception string.

## Found and fixed during SC-007

**SC-006 late invoice → BN-002 noncash preview mismatch.** The SC-006
snapshot includes an ORIGINAL late historical invoice in a later
period. BN-001 previously rejected ALL out-of-period original
dates, including explicitly audited SC-006 adjustments. This
inadvertently blocked BN-002 netting for a valid locked target.

- `lib/settlement-cycles/proposals.ts` now derives
  `auditedLateAttribution` through a trusted PostgreSQL
  `group_settlement_cycle_adjustments` membership query matching
  the target cycle, original expense ID and source version.
- The pure `bilateral-calculator.ts` only permits a historical
  `occurredOn` outside the target cycle if that SQL-proven boolean is
  TRUE **and** all the existing locked-source, group, cycle,
  version, currency and pair rules still pass.
- The ORIGINAL `occurredOn` is NOT changed. It remains the FIFO tie
  breaker and permanent audit date. A forged/out-of-period invoice
  without a real adjusted snapshot is still denied.
- Seed-based unit and real authenticated HTTP regressions verify
  the positive and negative paths. No new financial event is written.

## Release gate: **NO-GO, even when CI is green**

| Gate | Result | Reason / next action |
| --- | --- | --- |
| P0 isolated implementation SC-001…SC-007 / BN-001…BN-006 | VERIFIED IN ISOLATION | Tests pass on disposable PG17, not a production approval |
| Independent financial conservation | VERIFIED IN ISOLATION | Repeat against an **isolated Neon test branch** and compare bounded known real migrations before rollout |
| Live production release flag | **OFF — REQUIRED** | `SETTLEMENT_CYCLE_ENGINE_READY=false`; SC-005/BN-004/BN-006 writes only possible via exact local CI-only triple condition |
| Product mobile cycle and pair approval UI | **BLOCKED** | SC-008 not yet implemented |
| Reminder, dispute, audit/export and reconciliation UX | **BLOCKED** | SC-009 not yet implemented |
| Operations monitoring, retry/deadlock recovery, backups, restore drill, staged rollout | **BLOCKED** | SC-010 not yet implemented |
| Browser/device E2E of full mobile finance UI | **NOT EXECUTED** | To be implemented/tested with SC-008; current E2E is actual authenticated Next.js/Better Auth/PostgreSQL HTTP, not browser UI automation |
| Real shared Neon migrations / staging rehearsal / production sign-off | **NOT AUTHORIZED** | Explicit independent rollout decision required |

**Conclusion:** SC-007 verification is done; **production financial
release remains NO-GO**. Do not infer that a successful feature PR or
unit/integration CI green is permission to turn money ON.
Keep PR #16 **Draft**, do not merge, migrate shared Neon,
deploy staging/production or start SC-008 within this ticket.
