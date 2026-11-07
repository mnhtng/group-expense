# BN-001 — Strict pairwise BigInt noncash set-off calculator (pure)

> Scope: **one pair of distinct persons, one group, one LOCKED cycle, VND**.
> Ticket BN-001 only. This is a deterministic, side-effect-free calculation.
> No SQL/ORM, network, request, migration, new route, set-off proposal,
> approval, ledger, payment, state transition or release flag is added.

## Public pure function

`lib/settlement-cycles/bilateral-calculator.ts` exports
`calculateBilateralSetoff(input: BilateralCalculatorInput)`.

The input specifies:
- `groupId`, `cycleId`, `cycleState: "locked"`, `currency: "VND"`;
- `periodStart` / `periodEnd`: **local calendar dates** `YYYY-MM-DD`,
  a half-open interval `[periodStart, periodEnd)`;
- `partyAId != partyBId` and ALL eligible obligation source rows, including
  zero-available rows, in any original order;
- for EACH original source: original `obligationId`, exact group/cycle,
  VND, debtor/creditor, `occurredOn`, snapshot/live expense versions,
  explicit flags `inLockedCycleSnapshot:true`,
  `obligationVoided:false`, `expenseDeleted:false`,
  `originalMinor`, `confirmedCashMinor`, `pendingCashMinor`,
  `confirmedSetoffMinor`, `pendingSetoffMinor` as decimal strings.

This function is pure mathematical modeling. The asserted flags and balances
are **NOT independently verified** by this function; a future authenticated
SQL adapter MUST derive them from the source obligations, immutable snapshot,
current settlement statuses and (later) noncash set-off ledger under the
proper group/cycle/obligation locks. Do not use a user's request payload
directly as the calculator's source of authority.

## Exact conservation laws

For every original obligation `o`:

```text
confirmed_o   = confirmed_cash_o + confirmed_setoff_o
outstanding_o = original_o - confirmed_o
reserved_o    = pending_cash_o + pending_setoff_o
available_o   = outstanding_o - reserved_o

original_o > 0
0 <= confirmed_o <= original_o
0 <= reserved_o <= outstanding_o
available_o >= 0
```

Group by EXACT direction, `A -> B` and `B -> A`, within ONE
`(group, locked cycle, VND)` scope. NEVER route to person C or use a
cross-cycle sum.

```text
A = SUM(available_o, debtor=A, creditor=B)
B = SUM(available_o, debtor=B, creditor=A)
offset = min(A,B)

SUM(proposed_allocations_A_to_B) = offset
SUM(proposed_allocations_B_to_A) = offset
residual_available_A_to_B = A - offset
residual_available_B_to_A = B - offset
```

- Both proposed directions have **equal** set-off value. No creation
  of currency, no rounding, no floats, no implied cash transfer.
- Pending cash/set-off reserves availability but is NEVER treated as
  confirmed. `outstandingAfterHypotheticalSetoff` retains pending
  reservations; it is NOT a paid balance or completion signal.
- If either direction has zero available, offset is exactly zero.
- Fully confirmed obligations remain valid inputs with available zero
  and cannot generate new offsets.
- Per-source amounts are bounded by Postgres signed `bigint`; total
  aggregates use arbitrary-precision JS `bigint` and may exceed that
  bound. Every public minor-unit amount is serialized as a decimal string.

## Deterministic allocation

Within EACH direction, sort original sources by:
1. `occurredOn` ascending (canonical local ISO `YYYY-MM-DD`),
2. original `obligationId` ascending (canonical lowercase UUID).

Walk in that order and take `min(remaining_offset, available_o)`;
omit zero allocations. Allocation rows retain the original obligation ID,
original invoice version, local date, amount available before, proposed
offset and available after. Stop once that direction's exact `offset`
is allocated. Never modify the input objects, reorder the supplied array
in place or synthesize a new invoice, obligation or receivable.

A shuffled input produces exactly the same output. Swapping labels A/B
only swaps the two directions, without changing the offset value.

## Fail-closed eligibility

The calculator throws `BilateralCalculationError` with an explicit code:
`INVALID_INPUT`, `INVALID_SCOPE`, `STALE_OR_INELIGIBLE_SOURCE`,
`DUPLICATE_OBLIGATION`, or `INVALID_MONEY`.

Reject:
- Missing or malformed scope IDs, same person twice, non-VND, non-locked
  cycle, bad date range or local invoice date outside `[start,end)`.
- ANY source belonging to another group, cycle, currency, third
  participant or the same payer/payee; never silently filter such rows.
- Missing snapshot attribution, voided obligation, deleted expense,
  invalid/future invoice version or mismatch between snapshot and live
  invoice versions; invalid dates including non-leap February 29.
- Duplicate original obligation IDs, even if one row points in the
  opposite direction.
- Untrusted JS `number` or `float`, decimal/exponential/negative,
  spaces, leading zeroes, nonsensical booleans, overlarge values;
  confirmed debt exceeding the original or pending reservations
  exceeding live outstanding.
- Incoherent source data should cause **no result**, not a partial offset.

## Test coverage

`tests/bilateral-calculator.test.mjs` (Node's native test runner with
TypeScript strip-types) covers:
- Exactly equal, unequal, zero, one-direction-only and fully paid sides;
- Mixed partial confirmed cash, already confirmed noncash set-off and
  both pending reservation categories;
- Stable deterministic oldest-date then UUID selection, partial allocation
  to original obligation and no mutation of frozen inputs;
- Strict wrong group/cycle/currency, third person, duplicate ID,
  invalid original versions, deleted/voided, local date out of range;
- All money encoding failures, overpaid/overreserved, BigInt amounts
  above `Number.MAX_SAFE_INTEGER` and aggregate above signed PG bigint;
- 1,200 deterministic seeded property scenarios verifying exact amount
  conservation and identity, plus 10,000 eligible source obligations
  (no 50/500 UI limits).

The existing GitHub CI still runs lint, typecheck, all unit tests and
production build; PostgreSQL 17 + HTTP integration CI keeps existing
SC-001...SC-005 behavior/regressions intact. BN-001 itself has no
database interaction or new migration to execute.

## Hard release boundary

BN-001 returns `kind:"BN-001_CALCULATION_ONLY"` and NEVER claims
approval or actual discharge. It does NOT create a proposal fingerprint,
store a proposal, ask for approvals, write a set-off allocation, alter
cash statuses, mark an invoice/cycle paid, or recalculate later
post-payment balances with stale assumptions.

**Deferred strictly to later separate tickets:** BN-002 proposal and
fingerprint persistence, BN-003 two distinct signatory approvals, BN-004
atomic equal opposite-side noncash ledger application, BN-005 ledger
integration and BN-006 residual cash. Do not use BN-001 as an authorization
to mutate money. `SETTLEMENT_CYCLE_ENGINE_READY=false` remains unchanged;
Draft PR #16 remains unmerged. No shared Neon DB or staging/prod deployment.
