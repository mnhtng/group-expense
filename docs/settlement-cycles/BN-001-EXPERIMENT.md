# BN-001 practical experiment — weekly shared dinner expenses

**Date of verification:** 2026-11-05
**Code commit:** `45279fa2182728857229813e90e7f2cb4a1657c3`
**Scope:** One group, one LOCKED local weekly cycle `[2026-11-01,2026-11-08)`,
exactly two distinct members A and B, VND, six original obligations.
This is a **pure read-only example**, not a ledger entry, payment,
cash reservation or a persistable proposal.

## Source invoice fixtures

| Date | Original direction | Original VND | Confirmed cash | Pending cash | Confirmed set-off | Pending set-off | Eligible |
|---|---|---:|---:|---:|---:|---:|---:|
| 01/11 | A owes B | 140,000 | 40,000 | 20,000 | 0 | 0 | 80,000 |
| 02/11 | A owes B | 90,000 | 0 | 0 | 0 | 0 | 90,000 |
| 03/11 | A owes B | 60,000 | 0 | 0 | 10,000 | 15,000 | 35,000 |
| 01/11 | B owes A | 125,000 | 25,000 | 0 | 0 | 0 | 100,000 |
| 02/11 | B owes A | 80,000 | 0 | 30,000 | 0 | 0 | 50,000 |
| 03/11 | B owes A | 45,000 | 0 | 0 | 5,000 | 0 | 40,000 |

`outstanding=original-confirmedCash-confirmedSetoff`.

`available=outstanding-pendingCash-pendingSetoff`.

| Measured | A owes B | B owes A |
|---|---:|---:|
| Live outstanding (including pending) | 240,000 | 220,000 |
| Reserved pending | 35,000 | 30,000 |
| Available before hypothetical set-off | 205,000 | 190,000 |
| **Equal hypothetical set-off on each direction** | **190,000** | **190,000** |
| Available residual | **15,000** | **0** |
| Outstanding after hypothetical set-off | 50,000 | 30,000 |

The 15,000-VND *available* residual cannot be described as fully
settled cash while another 35,000 VND is still pending on A->B.

### Stable FIFO allocation down to ORIGINAL obligations

- A owes B, oldest invoice then original ID: **80,000 + 90,000 + 20,000**
  = 190,000 VND; final third invoice still has 15,000 VND available.
- B owes A: **100,000 + 50,000 + 40,000** = 190,000 VND.
- No third person or cross-cycle routing, no negative residual, no
  rounding or floating-point arithmetic.
- Reversing input order reproduces the EXACT same per-obligation amounts.
- Sources from a third person or a different cycle, over-reserved cash,
  and an invoice outside the local period are rejected before any result.

## Reproduce and audit

`pnpm test:unit` runs `tests/bilateral-calculator-experiment.test.mjs`
alongside `tests/bilateral-calculator.test.mjs`. Existing regression CI
also runs isolated PostgreSQL/HTTP tests to verify SC-001..SC-005 were not
broken by the pure new code.

- [CI SUCCESS — 86 tests, 0 failures](https://github.com/mnhtng/group-expense/actions/runs/41938338962).
- [PostgreSQL 17 + HTTP SUCCESS](https://github.com/mnhtng/group-expense/actions/runs/41938338952).
- [Exact experiment commit](https://github.com/mnhtng/group-expense/commit/45279fa2182728857229813e90e7f2cb4a1657c3).

**No execution of actual noncash set-off.** BN-002/BN-003/BN-004 are
separate future tickets for provenance, two independent approvals and
atomic ledger application; financial engine gate remains OFF.
