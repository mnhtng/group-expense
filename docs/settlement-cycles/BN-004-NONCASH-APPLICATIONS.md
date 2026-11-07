# BN-004 — Atomic two-sided noncash application (feature branch only)

> Scope: only BN-004. No cash settlement/receipt, no original obligation
> UPDATE, no BN-005 debt-balance integration, no invoice/cycle completion,
> no user-facing UI and NO real-money release.

## 1. What is stored

- `018_bilateral_noncash_applications.sql` defines immutable
  `group_settlement_bilateral_applications` and original-obligation-level
  `group_settlement_bilateral_application_allocations`.
- One application references exactly ONE immutable BN-002 proposal version,
  canonical (low,high) pair, one locked cycle/group, original source SHA256,
  snapshot SHA256, actor, request digest and exact `numeric(38,0)` VND
  set-off amount. Its `offset_minor` is **per direction**.
- Each applied allocation references an ORIGINAL `obligations.id` and
  equals exactly the positive `proposed_minor` of that proposal source.
  All 0-valued source records remain in the original BN-002 proof.
- The applied document is **NONCASH**. It records 0 VND actually
  transferred and never inserts a `settlements` or
  `settlement_allocations` row. Original invoices, obligations,
  item shares, approval events and snapshot remain unmodified.
- Immutability is enforced on BOTH tables by BEFORE UPDATE/DELETE
  PostgreSQL triggers. UNIQUE application per original pair/cycle and
  per original obligation prevent a second discharge while BN-005's
  integrated confirmed-setoff balance is intentionally NOT implemented.
- The application has a full immutable audit trail: proposal, original
  source fingerprint, both BN-003 decision-event IDs (through proposal
  reference), initiating actor, original ID/version, exact allocations
  and server timestamp.

## 2. Conditions for application

Actual A and B must have each independently signed **approve** on this
exact current proposal; no terminal reject/revoke/invalidate/expiry is
allowed. Neither group owner/admin/delegate nor a claimed client identity
can replace either participant.

Write locks follow: group -> locked cycle -> current proposal head/proposal
-> original obligations. The service independently recalculates
`BN-002-live-v1` from ALL frozen source obligations and live cash statuses
under locks. A source hash change, pair-head advance, group opt-out,
archival, inactive counterpart, expiry at 72 h, missing second approval,
pending/confirmed cash change or a prior application produces HTTP 409
and ZERO noncash writes.

The SQL trigger independently rechecks locked cycle/snapshot/opt-in,
active pair, both approvals, absence of terminal events, original
source amount/version and current pending+confirmed cash. The database
serializes direct SQL application with BN-003 revoke/reject on the
proposal row. Late revoke/reject after application is refused.

## 3. Atomic conservation and failure

`offset = min(available A->B, available B->A)`, in exact integers.
Every committed application must have:

```
SUM(applied A->B original obligations) == offset
SUM(applied B->A original obligations) == offset
count(applied allocations) == proposal.allocation_count
each applied amount == original proposed source amount
```

A DEFERRABLE INITIALLY DEFERRED PostgreSQL constraint trigger checks
the complete set in the transaction before commit; the service also
executes `SET CONSTRAINTS bn004_conservation_on_commit IMMEDIATE`.
Any forged, partial, one-sided or malformed write rolls back BOTH
directions together. There is no persistent in-flight setoff reservation
between signed consent and application: all original obligations are
locked and the two-direction discharge is atomic, not staged.

The application is intentionally NOT fed into the existing original
`outstanding` or `available` SQL projections until BN-005. This
prevents a partial integration from silently changing current cash
behavior; release gating stays CLOSED. Do not describe a BN-004
document as paid/completed in existing UI.

## 4. HTTP interface

`GET /api/groups/:groupId/settlement-cycle/cycles/:cycleId/bilateral-proposals/:proposalId/applications`
returns `{application:document|null,financialEngineEnabled:false}` for
one of the two participants. No balance or ledger write is performed.

`POST` to the same path requires EXACTLY:

```json
{"expectedVersion":1,"expectedFingerprint":"<sha256>",
 "requestKey":"UUID"}
```

All identities are session-derived, never client-provided. First actual
application: HTTP 201. Same-key same-actor and identical request: 200,
returning exactly the original immutable application document. Wrong
actor/version/fingerprint/request-key reuse, competing apply, stale money,
expired consent or incomplete signatures fail with 400/403/409.
Anonymous requests return 401.

**Hard runtime gate:** the global
`SETTLEMENT_CYCLE_ENGINE_READY=false` is unchanged. POST can write
ONLY if ALL server-side conditions are true:

```
CI=true
BN004_TEST_ONLY=isolated-pg17
DATABASE_URL=postgresql://test:test@localhost:5432/group_expense
```

The disposable CI runner adds the flag and tests a locally isolated
PostgreSQL 17 service. Production/staging/Neon cannot satisfy this
specific local URL condition. DO NOT enable the flag in production.

## 5. Test coverage / release safety

- Real PostgreSQL 17 migrations applied twice with hash verification.
- Real authenticated HTTP: unauthorized and nonparty admin, fake
  actor field, 0 and 1 signature denial, two distinct approvals;
  stale version/fingerprint, concurrent same-key [201,200],
  conflicting reapply and lost-response idempotency.
- Direct SQL one-signature bypass blocked; a one-sided application in
  a transaction rejected by deferred conservation and rolled back.
- Applied source proof and sums equal in BOTH directions for 122 original
  source obligations / 61+ original allocations per direction.
- UPDATE/DELETE to application and allocations refused; cash record
  counts unchanged; signer revoke after application refused.
- No application data in shared Neon, staging or production.
- PR #16 remains Draft and no merge/deployment is performed.

## 6. Explicit non-scope / next ticket

BN-005 must integrate committed `confirmed_setoff` into ALL reads and
subsequent availability guards, including original debt, leave/archive,
invoice completion and reports. BN-004 must NEVER implement those.
BN-006 later handles actual residual cash repayment; SC-008 later
handles mobile UI and notifications.
