# SC-006 — Late invoices, recurring sequencing, member leave and archive

**Status:** feature branch only; not released, financial engine is OFF.
Original financial source identities remain immutable. Do not merge PR #16
or run migrations on shared Neon / staging / production.

## Scope and invariants

- A historical LOCKED snapshot is permanently immutable. Never unlock,
  rewrite its totals, change original expense dates, or import a new debt
  into that frozen snapshot after its original cutoff.
- A late manual invoice or late recurring occurrence is an ORIGINAL
  `expenses` row (with its ORIGINAL `obligations`). Its accounting
  `occurred_on` date is unchanged. Attribution is a separate audited
  document, NOT an extra expense, obligation or bank transfer.
- An actual `recurring_expense_occurrences(rule_id,period)` remains
  unique/idempotent. A missed historical recurring occurrence follows
  the same rules as a manual late invoice, with no special cloned debt.
- Explicit manager action is required to assign the late source to the
  chronologically earliest subsequent **REVIEW** cycle; an earlier
  future OPEN cycle must reach REVIEW first. No automatic/backdated
  assignment to a different already LOCKED cycle.
- This feature does NOT grant a cycle manager the creator's permissions:
  only the original invoice creator may complete it, after any debt
  was discharged by confirmed cash/noncash and no pending cash remains.
- A cycle is a source attribution, NOT a cash payment or second bill.
  The BN-004/005/006 noncash + real-cash accounting stays untouched.

## Database and atomic audit

Migration `021_settlement_cycle_late_adjustments.sql` adds immutable
`group_settlement_cycle_adjustments` with:

- `(group_id,origin_cycle_id,target_cycle_id,expense_id)` identity
  with composite same-group foreign keys.
- `UNIQUE(expense_id)`: one source invoice may have exactly ONE later
  cycle attribution. `UNIQUE(group_id,actor_id,request_key)` also
  supports strict idempotent retries.
- `expense_version`, manager actor ID, optional note and trusted
  server timestamp. BEFORE INSERT trigger rechecks active group,
  current owner/delegate, requested setting, original LOCKED snapshot,
  current target REVIEW version 2, chronological ordering, first
  eligible next cycle, source's historic occurrence, original cutoff,
  original source absence and live invoice version.
- UPDATE/DELETE are refused even from direct SQL. The assignment freezes
  original financial edits, item/share mutation and obligation
  replacement immediately through expanded SC-004 immutable-source
  guards. Creator-only completion is still explicitly permitted.

The SC-004 REVIEW→LOCKED SQL guard and application preview/insertion
are upgraded together. They include the ORIGINAL attributed invoice and
all of its ORIGINAL obligation IDs when sealing the later cycle,
using exactly the existing AS-OF BigInt monetary checks and SHA256
fingerprints. They permit out-of-period `occurred_on` only if the
audited assignment targets THAT cycle. The previous cycle's snapshot
never changes; a stale preview is HTTP 409. One source can be frozen
only once as origin obligation in the future cycle.

## HTTP

```
GET  /api/groups/:groupId/settlement-cycle/cycles/:originCycleId/late-adjustments
POST /api/groups/:groupId/settlement-cycle/cycles/:originCycleId/late-adjustments
{
  "expenseId": "<existing original invoice UUID>",
  "targetCycleId": "<earliest eligible review cycle UUID>",
  "expectedExpenseVersion": 1,
  "requestKey": "<UUID>",
  "note": "optional <= 500 characters"
}
```

GET is accessible to currently active group members; returns all
late original sources, original dates and recurring provenance
(`ruleId,period`), currently recorded target (if any), eligibility
of earliest future reviewed cycle and effective finance flag FALSE.
POST requires the current group owner or active delegated cycle manager
and session-derived actor; other admins and the invoice creator alone
have no management bypass. Forged amounts, changed versions, duplicate
sources, wrong targets or already sealed targets are rejected.
Same actor + same request key + identical content returns the original
immutable audit document. The financial engine stays disabled.

## Deterministic recurring processing and member lifecycle

- The existing daily Cron now runs recurring generation **before**
  cycle metadata catch-up, rather than concurrently. If recurring
  generation has errors or hits the 20-invoice batch cap, cycle
  metadata catch-up is deferred with a monitoring error. Snapshot
  sealing remains a separate explicit manager-approved action.
- Recurring catch-up cannot create two invoices per month due to
  the existing UNIQUE(rule_id,period); all missed invoices retain
  their actual scheduled_on and only become a late adjustment
  candidate when they miss an earlier locked source snapshot.
- On leave/removal: an active member who is the sole invoice creator
  of an unfinished frozen/attributed/late cycle invoice cannot leave
  even if the monetary balance is already zero. The creator must
  complete their invoice first. Noncreator owner/admin cannot do it
  for them. Existing debt/pending checks still apply.
- Leaving a group atomically pauses any active monthly expense template
  created by, paid by, or explicitly allocating shares to that member.
  Previously created occurrences and invoices stay unchanged; the
  creator must explicitly edit/re-enable the rule after roster change.
- A group with OPEN/REVIEW cycles, an unfinished locked original
  invoice, unresolved snapshot debt/pending, or unassigned late
  invoices from locked periods is not archivable. When all historical
  source obligations and creator responsibilities are resolved,
  a fully LOCKED cycle can remain immutable and the group may be
  archived. Never fabricate a `completed` cycle state (SC-007+).

## No unlock / no retroactive edits

There is deliberately **no unlock action**. Recover mistakes through
an audited new financial adjustment in a future review cycle; change
neither the old source invoice nor locked snapshot. SC-006 supports
**late ORIGINAL invoice inclusion**; actual compensation/refund of an
already locked and previously paid invoice is deferred to a
separate explicitly scoped financial adjustment workflow. Silent
negative expenses and negative cross-member transfers are forbidden.

## Acceptance / no-release

- Disposable PostgreSQL 17: all migrations up to 021 applied twice.
- Real authenticated HTTP: one sealed historical cycle, late original
  invoice, no original snapshot change, owner-only attributed source,
  concurrent same-key idempotency, rejected unrelated admin/creator,
  stale version, absent/incorrect target, immediate financial freeze,
  later REVIEW snapshot fingerprint change, locked snapshot includes
  original obligation exactly once, no duplicate expense or obligation.
- Creator-only completion with ZERO debt blocks departure while
  unfinished; after creator completion, departure pauses their
  monthly template in the SAME membership transaction. Once all
  original sources are resolved, owner may archive the completed
  financial group without rewriting locked audit.
- Existing SC-001 through BN-006 regression, Next.js TypeScript,
  unit tests, lint and build must all stay green.

**Hard no-rollout:** `SETTLEMENT_CYCLE_ENGINE_READY=false` remains
unchanged; no staging/production/Neon migration and PR #16 stays
Draft/unmerged. SC-007 full E2E/concurrency/release review, SC-008
mobile UI and SC-009 notifications are NOT part of SC-006.
