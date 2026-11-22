# SC-026 — Retroactive manual settlement periods and editable drafts

**Branch:** `feat/retroactive-manual-settlement-periods` branched from `develop`.  
**Scope:** Backdate initial MANUAL schedule anchor and create manual periods for earlier invoice dates. Edit or cancel **user-created MANUAL / OPEN** periods only. Never change REVIEW/LOCKED periods, schedule history, saved snapshots, CASH/NONCASH allocation or original invoices.  
**Release:** Implementation branch only; **migration 026 NOT applied to shared Neon staging or production** by this task. Human release authorization is still required.

## How a person uses this

1. Group owner or an explicitly delegated settlement manager enables **Bật quyết toán**, then opens **Quản lý nhóm → Cài đặt quyết toán → Lịch quyết toán**.
2. On first setup, select **Thủ công**, choose the desired historical **Bắt đầu từ** date and save. This date is the *earliest valid manual cycle start*, not a cycle itself. The schedule can become effective immediately if the anchor is in the past. Existing active schedules are intentionally not rewritten in the past: switching an already running automatic/manual schedule still follows the existing next-boundary policy.
3. Open **Tạo kỳ**, choose **Bắt đầu kỳ** and **Kết thúc kỳ (exclusive)** and create the manual period. Its start must not precede its manual anchor or be in the future; length at most 370 days; no overlap with any existing active period or later schedule cutover. Older invoice dates can be included even if the group only enabled settlement today.
4. Each **manual / Đang mở** period now displays **Sửa kỳ** and **Hủy kỳ**. Editing changes only its start/end bounds, keeps the same cycle ID, and writes a separate append-only audit event. Hủy kỳ requires an extra confirmation, hides it from cycle lists/lookup and **releases its date slot**; underlying creation and change history remain untouched. A new requestKey is needed to create a replacement.
5. After pressing **Chuyển sang chờ kiểm tra** (OPEN→REVIEW), the edit and cancellation buttons disappear; PATCH/DELETE are rejected at API, service and database layers. LOCKED snapshots and all existing debt/payment confirmation flows are unchanged.
6. A client trying to review a period edited from another session gets HTTP 409 by comparing `expectedDraftRevision`; legacy review clients without this field can still review untouched revision 0, but cannot accidentally approve a later edited version.

## Implementation boundaries

- `012`, `013`, `014` and `021` migration checksums remain untouched; new additive `026_manual_cycle_drafts.sql` extends the latest `sc003_guard_cycle()` and preserves its full SC-004/SC-006 frozen snapshot validation.
- `draft_revision` is independent from the lifecycle version, preserving the existing immutable sequence **1 created → 2 review → 3 snapshot locked**, including event constraints.
- A cancel is **not a hard SQL DELETE**: `cancelled_at`, `cancelled_by` and the immutable `group_settlement_cycle_draft_events` retain provenance. Partial GiST exclusion and active per-revision start uniqueness release the canceled time interval without weakening non-overlap checks for live periods.
- The draft table has UPDATE/DELETE/TRUNCATE-blocking triggers. `FINANCIAL_CLASSES`, runtime role grant inventory and recovery digests include the new audit table; deploying migration26 without also reviewing the limited runtime role's privileges is unsupported.
- Application mutations require authorized owner/delegate inside the group transaction and lock, exact expected lifecycle/draft revisions, and optimistic safety checks for future cutover, overlapping periods and manual anchor.
- Scheduled weekly/biweekly/monthly periods are not edited/cancelled by this feature because their automated recurrence and cron catch-up semantics differ. Existing running schedule revisions are not rewritten retroactively; this requires separate design if desired.
- Manually backfilling historic periods is explicit; it **does not manufacture CASH/NONCASH transactions, change old payment confirmations, or silently erase a previous snapshot**.
- Financial engine admission remains controlled separately by SC-025. Group preferences never bypass the cohort/release gate.

## Required acceptance before release

Run on a fresh **disposable local PostgreSQL 17** (never shared Neon):

```bash
pnpm install --frozen-lockfile
pnpm db:migrate
pnpm db:migrate
pnpm test:unit
pnpm test:integration
pnpm typecheck
pnpm build
```

Required negative and positive evidence: first manual schedule anchor in the past; create past manual cycle; edit an OPEN manual cycle within its calendar boundaries; overlapping edit 409 / PostgreSQL 23P01; cancel OPEN manual draft with immutable audit; new same-date replacement; stale draft revision 409; review forbids further edits/cancel; locked snapshot still frozen; no financial row changes; permission denial for regular members/outsiders; runtime limited role attestation with new table; recovery digest includes audit.

**Current execution evidence:** Static source-contract checks were executed against fetched GitHub source; these are not substitutes for a full real PostgreSQL/HTTP/UI run on the feature commit. No DB migration or PR merge/deployment was performed remotely.
