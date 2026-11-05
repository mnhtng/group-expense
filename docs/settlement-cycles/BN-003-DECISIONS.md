# BN-003 — Independent bilateral decision history, revocation, rejection, expiry and invalidation

> Scope: only the approval/decision state of existing immutable BN-002
> proposal DOCUMENTS. BN-003 DOES NOT create noncash ledger entries, reserve
> available obligations, complete invoices, apply any offset or disburse cash.
> Global `SETTLEMENT_CYCLE_ENGINE_READY=false` remains unchanged.

## 1. Signatures belong to ONE immutable source fingerprint

Each BN-002 proposal has its original immutable pair, group, cycle, version,
snapshot fingerprint, live financial fingerprint, amount and complete
original-obligation sources. An independent decision is allowed only from
one of the ACTUAL TWO counterparties and is linked to:
`(proposal_id,version,source_fingerprint,actor_id,request_key,event_type)`.

- Creating a proposal never signs it, even if the creator is one of the pair.
- `approve` by member A creates ONLY A's signature for that version.
- `approve` by member B creates ONLY B's signature; two distinct approvals
  produce the derived status `agreed`.
- `agreed` means both people consent to the proposed *hypothetical* offset.
  It is **NOT** `applied`, `paid` or permission to modify live balances.
  API always returns `readyForApplication:false`,
  `financialEngineEnabled:false`. BN-004 must independently revalidate
  the entire source ledger and its signatures under locks.
- `reject` by either counterparty while awaiting decisions is terminal:
  the same proposal ID and version can never collect more approvals.
  Reject after both approved is blocked: a person who signed must use
  explicit `revoke` to rescind consent.
- `revoke` is available ONLY to a counterpart who ALREADY approved that
  exact version. It is a terminal event, even after both signed (before
  any future ledger application). Neither counterparty can undo it on
  that version. A new BN-002 version needs fresh signatures.
- A new proposal version after rejection, revocation, invalidation or
  expiry can reuse identical current live financial fingerprint (provided
  the origin is unchanged); ALL signers start from zero approvals.
  A new version never inherits the old proposal's event history.

## 2. Effective state machine

No mutable `approved=true` flags are stored. The read model derives
current status from immutable event history, canonical pair head,
current time and source-ledger validity:

```text
pending (0 signatures)
  -> partially_approved (1 distinct signer)
     -> agreed (2 distinct signers)
  -> rejected (terminal, before agreement)
  -> revoked (terminal, by an existing signer, including after agreement)
  -> invalidated (terminal, financial sources / eligibility changed)
  -> expired (terminal, after 72 hours)
  -> superseded (previous version loses canonical HEAD)
```

`agreed` is a reversible **consent** status until a separate, fully
validated BN-004 application; it does not create reservations.

Derivation precedence:
1. A previously recorded terminal event (reject/revoke/invalidate/expire)
   remains historically visible forever.
2. An older version whose pair HEAD advanced is `superseded` and can
   never receive another decision.
3. At `created_at + 72 hours` (PostgreSQL/server clock), the current
   proposal is `expired`; no approve/reject/revoke is accepted.
4. If the group disables cycles/netting, becomes archived, a signatory
   becomes inactive, original source changes, cash `confirmed` or
   `pending` changes, the snapshot/cycle is no longer valid or the
   live source SHA256 differs, the proposal is `invalidated`.
5. Otherwise return `agreed` / `partially_approved` / `pending`
   according to the two independent recorded approvers.

A GET projects time/stale state without writing audit events.
An attempted decision on a stale or expired CURRENT proposal stores
exactly ONE immutable `invalidated` or `expired` system event in
its transaction, COMMITs the event and THEN returns HTTP 409.
This avoids silently losing audit history due to a rollback. A later
read reports the terminal state even if the source financial values
have changed again. Unlike a payment, no approval automatically reserves
availability.

## 3. Persistence and SQL integrity

Migration `017_bilateral_decision_events.sql` adds ONLY
`group_settlement_bilateral_decision_events`.

Fields: `id`, proposal/group/cycle/low/high composite source FK,
`actor_id` (nullable ONLY for system expired/invalidated),
`event_type`, `request_key`, SHA256 `request_digest`,
immutable BN-002 `source_fingerprint`, `recorded_at`.

DB enforcement:
- All decisions must reference one immutable BN-002 proposal and exact
  fingerprint; only A/B may sign. Group admin/owner/delegate unrelated to
  either member cannot sign on their behalf.
- At most one `approve` for each original signatory in a proposal.
  Unique `(group,actor_id,request_key)` prohibits reusing a key for
  another revision; `(proposal,request_key)` is unique for both users
  and system events.
- At most ONE terminal event per proposal, enforced by partial unique
  index, with append-only UPDATE/DELETE triggers.
- SQL BEFORE INSERT holds the original proposal row `FOR UPDATE` before
  reading any prior event: even direct SQL APPROVE-vs-REJECT races cannot
  both decide from a stale event list.
- Database also revalidates the current proposal head, active pair,
  cycle opt-in, locked snapshot provenance, original invoice versions,
  `confirmed/pending` cash totals, and availability conservation.
- A forged early `expired`, a made-up `invalidated` event on unchanged
  financial sources or revoked-by-nonapprover action is rejected.
- DB trigger and service perform complementary checks: only the service
  can recompute the full BN-002 SHA from canonical live source rows.
  BN-004 MUST repeat that rehash and not rely only on stored signatures.

## 4. Transaction/identity/idempotency

`GET /api/groups/:groupId/settlement-cycle/cycles/:cycleId/bilateral-proposals/:proposalId/decisions`

Session-derived actor (401 anonymous), active group membership and
exact signatory authorization (403 for unrelated admins). Returns:

```json
{
  "proposalId":"uuid","version":1,"status":"partially_approved",
  "approvedBy":["actual-user-id"],"approvalCount":1,
  "expiresAt":"ISO UTC timestamp",
  "isCurrent":true,"liveMatches":true,
  "canApprove":true,"canReject":true,"canRevoke":false,
  "readyForApplication":false,"financialEngineEnabled":false,
  "events":[{"id":"uuid","eventType":"approve","actorId":"actual-user-id","recordedAt":"ISO"}]
}
```

`POST` to same URL:

```json
{
  "action":"approve",
  "expectedVersion":1,
  "expectedFingerprint":"64 lowercase hex characters",
  "requestKey":"8c134b5d-3450-4b3d-af2a-e2892ab51242"
}
```

Actions: `approve`, `reject`, `revoke` ONLY; no `apply`,
`complete`, money amount, counterparty identity or client-supplied actor
field. Identity comes from the authenticated session.

Write transaction obtains **group lock first**, then cycle, pair proposal
head, and current original obligations. Exactly one append-only event
commits. A genuine first action is 201; same key + same actor + same
version/fingerprint/action returns 200 and its original decision ID.
A conflicting reused key, second approval by the same actor, old version,
wrong fingerprint, wrong party, late approval or stale source returns 409
(or 403 where authz fails). A decision already committed remains
idempotently retrievable after group opt-out. A denied action never writes
cash allocations, obligations or noncash offsets.

## 5. Test and release gates

The isolated PostgreSQL 17 + HTTP test fixture reuses the 122-original-
obligation BN-002 pair and verifies:
- Both signatories really authorize separately; creator is NOT
  automatically approved, outsider admin cannot sign;
- Same-key concurrent approval [201,200] produces one append-only event;
- Second distinct counterparty may approve (status `agreed`), and the
  application flag remains FALSE; old version cannot be signed;
- APPROVE vs REJECT race has no inconsistent shared state;
- Duplicate approvals, key reused for another action/version, deliberate
  forged SQL actor/source and unauthorized access fail;
- Existing signer can revoke after both agreed; terminal revocation
  invalidates all signatures on that version; next version starts at zero;
- One counterparty can reject before agreement, terminal rejection,
  same-fingerprint new version permitted with two new signatures;
- Live cash becoming pending/confirmed after a signature produces
  `invalidated` and stores a single system terminal event before HTTP 409;
- A directly-constructed 73-hour-old historical fixture is `expired`;
  a current proposal cannot have `expired` forged before 72 hours,
  and retries cannot create duplicate expiry events;
- Immutable event DELETE/UPDATE fails at DB level, source cash counts
  remain unchanged except for the test's explicitly created manual cash
  reservations.

**No ledger writing, set-off execution, offset application, payment
notification or mobile approval UI (SC-008) in BN-003.**
PR #16 stays Draft; `develop`/`main`, shared Neon and production are
unchanged. Financial engine remains OFF. BN-004 is a SEPARATE ticket.
