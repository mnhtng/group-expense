# BN-002 — Immutable bilateral proposal documents and live-data fingerprint

> Ticket-only scope. A proposal is **unapproved**, **not a reservation**
> and **not an actual set-off**. Production financial engine remains OFF.
> No new cash/offset rows, invoice completion or balance mutation.
> Future BN-003 independently implements two-person approvals;
> future BN-004 implements noncash ledger application.

## Scope and identity

Exactly one group, one LOCKED cycle with SC-004 immutable snapshot,
one unordered pair of distinct ACTIVE members, and VND.
`party_low` and `party_high` are a canonical unordered pair so
`(A,B)` and `(B,A)` address ONE proposal head; all individual
obligations retain their ORIGINAL debtor/creditor direction.

One current proposal HEAD per (group,cycle,pair) with monotonically
increasing version. Each new proposal DOCUMENT is immutable; it captures:
- initiator identity (one of the true two counterparties), UUID idempotency
  request key, request digest, monotonically increasing version,
- exact immutable cycle snapshot SHA256, live-source SHA256,
- source count (INCLUDING fully paid zero-available source obligations),
- nonzero allocation count, equal proposed noncash offset amount,
- complete original source proof (one row per original obligation):
  obligation ID, original debtor/creditor, local invoice date, immutable
  invoice financial source version, original amount, confirmed/pending
  cash, confirmed/pending noncash set-off (both zero until future tickets),
  live available BEFORE, proposed noncash amount, hypothetical available AFTER.

There is no status like `approved`, `applied`, `rejected`,
`completed` or `reserved` in BN-002. A later version changes ONLY the
head pointer; old documents and original-source rows are never edited
or deleted. No proposal is interpreted as a cash payment.

## Stable fingerprint and optimistic concurrency

`BN-002-live-v1` SHA-256 is calculated deterministically from:
group, cycle, immutable snapshot fingerprint, ordered pair, exact local
`[start,end)`, and **all** original source rows, including zero available.

Each source includes: ID, pair direction, invoice date and financial
version, original, confirmed/pending cash, confirmed/pending set-off,
available, proposed amount and remaining hypothetical availability.
Rows are canonically ordered by local invoice date then UUID.
Fingerprint also binds BOTH pre-offset available totals and resulting
offset. All money is exact `bigint` internally and serializable decimal
strings publicly.

`POST` requires `{partyAId,partyBId,expectedVersion,expectedFingerprint,requestKey}`.
No client-supplied amounts or allocations. New proposal is permitted only
if its live SHA matches the preview; existing current proposal has
different SHA; and `expectedVersion=head.version`.
Otherwise HTTP 409, entire transaction rolled back.
Retrying the SAME UUID by the same initiator and identical request
fields returns the ORIGINAL saved document (200), even after a later
head revision or group opt-out. A conflicting request digest is 409.

New proposal version does NOT silently reprice or modify an earlier
proposal. A proposed document from an older version can be recognized
as superseded, but approval invalidation/expiry is delegated to BN-003.

## Auth and lock discipline

- Session-derived identity; anonymous 401.
- GET and POST are restricted to the ACTUAL two participants. A group
  owner/admin/delegate cannot act for unrelated members.
- Both participants must be active group members for NEW proposals.
- Group must be active and explicitly configured with BOTH
  `requested_enabled=true` and `requested_bilateral_netting=true`.
  All others fail closed for new writes. Historic documents persist
  unchanged after an opt-out.
- GET is a REPEATABLE READ READ ONLY transaction; returns live preview,
  current manifest if any, its version and whether it is stale compared
  with the live source fingerprint. No money/approval write.
- POST locks `groups FOR UPDATE` → locked cycle →
  canonical proposal HEAD `FOR UPDATE` → ORIGINAL source obligations
  `FOR UPDATE OF o` in UUID order. Existing cash writers acquire
  the same group lock first, preventing stale simultaneous reservations.
- Within ONE PostgreSQL transaction: authenticate/authorize, check
  opt-in, existing idempotency key, expected version, canonical live
  original obligations, BN-001 calculation and fingerprint; INSERT
  immutable proposal document; INSERT ALL source proof rows (including
  zeros); publish head version only after SQL validates complete exact
  source proof and both directional sums. Any error ROLLBACKS all writes.
- No UI debt list limit: 122 original sources / 61 positive allocations
  per direction are exercised in HTTP. The current per-proposal upper
  bound is 20,000 original sources, fail closed beyond it.

## Source provenance and completed invoice handling

Source data comes ONLY from the original `obligations` ledger joined
to the immutable SC-004 snapshot, original source invoice and current
`settlements + settlement_allocations` cash statuses.

```text
outstanding = original - confirmed_cash - confirmed_setoff
available   = outstanding - pending_cash - pending_setoff
offset      = min(SUM(available A→B),SUM(available B→A))
```

Cash `pending` is still unpaid and reserves live available money.
Cancelled/rejected cash is excluded. BN-002 has **no noncash set-off
ledger yet**, so all confirmed/pending noncash fields are exactly zero.
Merely creating a proposal neither reserves nor discharges anything.

After SC-004 lock, the original invoice creator can complete a fully
paid invoice; that operation increments the invoice metadata version by
exactly one but does NOT change original financial items, obligations
or their snapshot. BN-002's SQL adapter recognizes this exact
creator-only completion as a nonfinancial version increment, and uses
the unchanged original obligation financial version when calling BN-001.
Arbitrary changed versions or mutated money remain rejected.
Live cash confirmation does change the fingerprint; creator completion
after all cash is confirmed does not change it.

## PostgreSQL defense in depth

Migration `016_bilateral_proposal_documents.sql` adds:
- `group_settlement_bilateral_heads`: unique versioned unordered pair
  per group/cycle, atomic current document pointer and version guard;
- `group_settlement_bilateral_proposals`: immutable version, SHA,
  request key and initiator, exact amount and source counts;
- `group_settlement_bilateral_sources`: immutable complete
  original-obligation proof, immutable cycle snapshot FK and numerical
  source conservation CHECKs.

Database triggers independently enforce:
- source belongs to the EXACT cycle/pair, active original invoice/version;
- no inserted/edited/deleted sources after sealing a proposal;
- both parties are active at publication and opt-in remains enabled;
- source count equals all original pair obligations in snapshot;
- exact original vs cash ledger outstanding and pending values;
- each direction sums EXACTLY to the same proposed amount;
- proposed amount equals `min(total_available_AB,total_available_BA)`;
- per-source allocation obeys **strict FIFO date then obligation UUID**,
  rejecting balanced but intentionally misallocated raw SQL writes;
- no jump/rollback in proposal head version, and no history deletion.

This database does not independently validate the cryptographic SHA via
pgcrypto; the authenticated server computes/checks it from canonical SQL
under locks. BN-003/BN-004 MUST re-hash under locks before any possible
approval/application. SQL integrity and exact amount checks are separate.

## API contract

`GET /api/groups/:groupId/settlement-cycle/cycles/:cycleId/bilateral-proposals?partyAId=A&partyBId=B`

Returns `{fingerprint,snapshotFingerprint,calculation,eligibleSourceCount,
writable,currentVersion,current,staleCurrent,approvalEnabled:false,
financialEngineEnabled:false}`. `calculation` is BN-001
`CALCULATION_ONLY` with directional allocations, not an approval.

`POST` to the same URL:
```json
{
  "partyAId": "member-a",
  "partyBId": "member-b",
  "expectedVersion": 0,
  "expectedFingerprint": "<exact-64-lowercase-sha256>",
  "requestKey": "7e59c54d-537b-4d62-955b-32fb762bc4d4"
}
```
First persisted version returns 201; idempotent repeat returns 200;
stale/revision/request-key conflicts return 409; unauthorized participant
403, outsider 404, unauthenticated 401; malformed fields 400.

**IMPORTANT:** `requested_bilateral_netting=true` is permission to
record PREPARATORY documents, **not permission to execute noncash
set-off**. `SETTLEMENT_CYCLE_ENGINE_READY=false` remains unchanged.

## Tests and explicit non-scope

- Native GitHub CI: lint, TypeScript check, unit/property BN-001, build.
- Disposable PostgreSQL 17 double migration + full API HTTP regression.
- New HTTP test: default-OFF and bilateral-OFF, non-party admin denied;
  snapshot locked, 122 original obligation sources, **61 allocations
  EACH direction**, 2 actual counterparties racing [201,409],
  same request key [200] regardless of old current revision, stale
  fingerprint after cash confirmation, new immutable v2, failed
  SQL tamper and rollback, no cash write by proposal, and persisted
  history unchanged after group disable.
- Direct adversarial SQL tries to publish a document with equal
  directional sums but wrong FIFO allocations: database must reject and
  transaction rollback without changing head.
- Creator-only completion of fully paid original invoices cannot
  break live proposal preview or rewrite historical financial values.

No BN-003 dual approvals, no BN-004 noncash ledger, no BN-005 paid/debt
integration, no SC-006 adjustments, no payment/offset notifications,
no full mobile proposal UX, no staging/prod deployment or shared Neon
migration in this ticket. Draft PR #16 remains unmerged.
