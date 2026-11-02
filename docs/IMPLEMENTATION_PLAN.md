# Group Expense — Implementation roadmap (Next.js PWA, NO ORM)

**Goal:** Mobile-first Tricount-style group expense web app with itemized bills,
traceable debts, and two-party confirmation of repayments. **Use this repository.**

## Stack and non-negotiables

- Next.js 16.4.3 App Router; React 19.3; TypeScript; pnpm; existing shadcn/
  Base UI/Tailwind theme and Hugeicons.
- PostgreSQL with node-postgres (`pg`), parameterized SQL, versioned `.sql`
  migrations. Never introduce Prisma, Drizzle or other ORMs.
- Currency: VND integer minor units, `bigint` for calculations, string on JSON.
- Authentication: reuse existing solution if present, otherwise evaluate Better Auth
  with direct PostgreSQL. Persistent DB sessions, HttpOnly cookie, sliding lifetime
  365 days / renew after 24h of activity; revoke on logout and security events.
  Cannot promise persistence after cookies are deleted or session is revoked.
- PWA: mobile navigation, manifest, proper PNG icons, safe static caching, Web
  Push only after durable in-app notifications.

## Main screens

Home/groups; group detail (Chi tiêu, Số dư, Thành viên); quick/itemized expense;
item allocation editor; expense detail; personal debts by group/person; debt
timeline; settlement creation/review; notifications; account/install instructions.
Bottom tabs: Nhóm, Công nợ, Hoạt động, Cá nhân.

## Model and invariants

Auth user/session -> groups/members/invites -> expenses/items/item_shares ->
obligations/obligation_sources -> settlements/allocations/events ->
notifications/push_subscriptions/outbox/audit.

- Sum item shares = item total; sum expense items = expense total = sum paid.
- Obligation records who owes whom with item-source trace; never keep only net balances.
- Outstanding = original obligation - SUM(confirmed settlement allocations).
- Available = outstanding - SUM(pending settlement allocations).
- Pending -> Confirmed | Rejected | Cancelled. Only Confirmed reduces debt.
- Debtor can report "đã trả", or creditor "đã nhận"; the **other party** must confirm.
- Support partial and multi-obligation settlements for same pair/currency.
  Use transactions, locking/serialization, idempotency and immutable audit events.
- Restrict editing expenses after confirmed settlement; adjustments via reversal.

## Delivery milestones

| Sprint | Deliverables | Acceptance |
|---|---|---|
| S0 | Repo audit, mobile shell, PWA manifest, money helpers, tests, CI | Build & unit tests pass; no ORM |
| S1 | SQL migrations, `pg`, auth and persistent login, groups/invites | Two accounts join a group; logout revokes session |
| S2 | Itemized expense, shares, rounding, CRUD | Example 130,000 VND -> B owes 55,000; C owes 65,000 |
| S3 | Traceable obligation ledger and debt views | Balances trace to original expense items |
| S4 | Two-party partial repayment, rejection, cancellation | Double confirmations and races never double-pay |
| S5 | Durable in-app notifications, push, proper PWA | Home Screen UX and notification history tested |
| S6+ | Receipt attachment, QR, export, reminders, OCR | Prioritize after safe MVP |

## Critical test cases

- Deterministic rounding 100,000 / 3; invalid allocation; no floating errors.
- Group/user isolation; authorization on every server mutation.
- Pending settlement never reduces debt; counterparty confirms; initiator cannot
  confirm own request; cancel/reject releases reservation.
- Partial/multi-obligation allocations cannot exceed unsettled/reserved amounts.
- Concurrent confirmation/retry cannot create duplicate entries.
- PWA reload and reopen retains valid auth without login flash; logout revokes.
- Offline/network errors do not imply logout; no financial mutation while offline.

## Codex delivery policy

Always read `AGENTS.md` and `docs/REPOSITORY_AUDIT.md`. Keep changes bounded,
reuse components, add tests, document migrations and measured limitations. Never
reinitialize the Next.js project and never add an ORM.
