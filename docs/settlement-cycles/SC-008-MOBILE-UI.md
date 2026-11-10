# SC-008 — Member-facing mobile-first settlement cycle UI (feature branch only)

**Scope:** UI/UX layer only on `feat/settlement-cycles-bilateral`.
**Deployment:** NONE. **Release decision: NO-GO.**
`SETTLEMENT_CYCLE_ENGINE_READY=false` remains hardcoded in the
server module. In-app consent is NOT the financial release gate, and
no amount of clicking a client control can authorize money writes.

## Paths and entry point

- `/groups/:groupId` → discoverable **Quyết toán theo kỳ** entry.
- `/groups/:groupId/cycles?page=N` → mobile-first history with
  50 records/page; the currently logged-in active group member may
  browse older cycles using actual SQL pagination (no latest-50
  dead end). Owner/delegated manager sees a settings link.
- `/groups/:groupId/cycles/:cycleId?page=N` → direct authorized
  lookup by UUID (no latest-100 truncation). Open, Review or Locked
  state is displayed with date, timezone and correct manager actions.
- Open period links to original group invoices. Review shows existing
  SC-004 immutable financial snapshot preview and owner/delegated
  manager locking workflow. Locked shows detailed original-source
  ledger, two-person workbench, confirmed noncash proof, cash residual,
  history, and frozen-snapshot explanation.
- For an active manager on a locked original period, the SC-006
  late-invoice panel shows actually created ORIGINAL missed invoices,
  recurring occurrence provenance and exact next eligible REVIEW
  target; a two-step inline confirmation submits the immutable
  assignment. Non-managers cannot use the endpoint.

## Security, consent and data meaning

- Pages require authenticated `requireUser`, explicit
  `getMemberRole(groupId,user.id)` membership and nonarchived group
  checks BEFORE reading source data. Direct cycle lookup repeats
  membership checking; original source projection runs in
  REPEATABLE READ READ ONLY and re-checks active member + scoped
  locked cycle in SQL.
- All member/actor IDs submitted to decisions are taken from the
  signed session by server APIs; UI lets the member select **only
  one other person**. Owner/admin status never substitutes for
  actual pairwise consent.
- For a selected pair: live BN-002 preview shows both directions,
  hypothetical noncash amount per direction, immutable original
  obligation IDs/date/FIFO allocations. BN-003 current proposal
  shows status, individual approvals, expiry, stale-source warning,
  and only relevant actor-specific approve/reject/revoke actions.
  BN-004 applied noncash document is shown as a **noncash** debt
  discharge, with explicitly **zero bank cash transferred**.
- BN-006 residual shows only the actual one-direction live available
  money after applied setoff, the debtor and creditor, and historical
  pending/confirmed/rejected/cancelled ORIGINAL cash settlement
  requests. The existing real counterpart confirmation flow remains
  authoritative. Existing SC-005 one-way cash preview displays
  its separately pending amount and exact original allocation count.
- The original SC-004 financial snapshot **at lock time** and
  BN-005 **live** balances are explicitly separated. Live source
  amounts are BigInt numeric VND from `bn005_obligation_balances`:
  original, confirmed CASH, confirmed NONCASH, pending CASH,
  remaining and available. All six totals aggregate across
  the ENTIRE original frozen obligation set, independently of
  50-row UI source paging. Invalid balances fail closed.
- Each original line links back to the original expense;
  late-attributed SC-006 invoices preserve their original date
  and display a separate immutable assignment label. Creator
  invoice completion remains on existing invoice-detail screen,
  never delegated to a cycle manager.

## Mobile and accessibility

- Designed for touch: 44–48px minimum control height, content cards,
  two-column financial summaries, responsive wrapping, readable
  currency with tabular digits, no tiny overflow-only actions.
- Explicit Vietnamese labels distinguish `pending` from
  `confirmed`, and `cash` from `noncash` rather than mixing
  them into one misleading "đã trả" amount.
- Functional state has visible loading/error/status, inline
  two-step confirmation, explicit disabled controls, a reload
  action and safe cancellation. Stale fingerprint/version 409
  responses reload fresh original sources rather than submitting
  a guessed amount.
- Keyboard-accessible buttons, label-to-select association,
  `aria-live` through role=`status`/`alert`, `aria-expanded`
  and persistent controlled original-source disclosure. No
  auto-collapsing HTML `<details>` or browser
  `window.confirm` dialogs.
- Historical cycle pages have accessible previous/next navigation.
  A cycle's original source list also provides previous/next
  navigation without using the displayed page to sum financial totals.

## Implementation inventory

- Server read model: `lib/settlement-cycles/ui-read.ts` and
  historic direct/paged functions in `lifecycle.ts`.
- Pages: `app/(app)/groups/[groupId]/cycles/page.tsx`,
  `app/(app)/groups/[groupId]/cycles/[cycleId]/page.tsx`,
  group overview entry.
- Components:
  `settlement-cycle-source-list.tsx`,
  `settlement-cycle-finance-panel.tsx`,
  `settlement-late-invoice-panel.tsx`.
- Existing SC-004 snapshot, group management permission,
  original invoice completion and real settlement detail screens
  are reused. No new monetary service or migration introduced.

## Verification — code / real HTTP / release hold

1. `tests/sc008-cycle-ui.test.mjs` tests route access policy,
   page visibility, unpaginated original ledger aggregate,
   historical pagination, per-person actor gating, two-step
   consent, immutable late assignment UI and hard OFF release.
2. `tests/preview-http.smoke.mjs` uses a real signed Better Auth
   session + Next.js production server + PostgreSQL 17 to render
   group cycle list and sealed detail, verify release warning,
   **122 original obligations (>50 visible rows)**, confirmed
   CASH vs applied NONCASH vs pending cash, second-page financial
   totals unchanged, and audited original late-source invoice
   visible in the later locked snapshot. Unauthenticated cycle
   listing must not disclose member financial data.
3. All existing SC-001…SC-007 / BN-001…BN-006 unit, property,
   SQL, HTTP and independent pre/post ledger audit remain enabled
   in CI, including 16 concurrent SQL money reservations and the
   1,500-seed BigInt financial model.

**Explicit verification limit:** This SC-008 task has
server-rendered authenticated HTTP and static UI contract
coverage, not full physical iOS/Android/browser Playwright
interaction or visual regression snapshots. A controlled
staging rehearsal with actual device accessibility and
tap/focus/keyboard testing is still required before release.
SC-009 notification/dispute/audit UX and SC-010 operational
rollout are NOT implemented in this ticket.

**Release restrictions:** no test-only flags in product, no
shared Neon migration, no Vercel staging/production deployment,
no PR merge, no permission enlargement and no engine enablement.
PR #16 remains open **Draft**, base `develop`.
