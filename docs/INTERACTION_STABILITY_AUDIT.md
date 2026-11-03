# Interaction stability audit — Group Expense

## Scope (2026-11-03)
Reviewed every authenticated and unauthenticated `app/**/page.tsx`,
`components/{expenses,groups,notifications,settlements,auth}/**`, and
Server Actions. Searched for `<details>`, native `window.confirm`,
`router.refresh`, Server Action redirects, uncontrolled forms, polling
and accidental deletion. No database changes are required.

## Issues fixed

| Area | Previous problem | Now |
|---|---|---|
| Group management | Native `<details>` collapsed on RSC refresh | Dedicated stable route `/groups/:id/manage` (PR #12) |
| Rename group | Server Action submitted form; navigation/state could refresh unexpectedly | Client form + authenticated PATCH JSON; inline error and success |
| Archive group | Server Action redirect; errors surfaced as page failures | Client form + authenticated POST; preserve form on error; navigate only on success |
| Member management | Local eligibility snapshot could stay `owner` after transferring ownership | Derived from refreshed server props; no stale local eligibility |
| Remove/leave/transfer | Browser `window.confirm` interrupts installed PWA | Explicit persistent inline two-step confirmations next to controls |
| Delete expense | Browser modal + accidental deletion | Explicit inline confirmation; navigate away only after successful DELETE |
| Settlement decisions | Browser modal for confirm, other actions one-tap | Confirm/reject/cancel each require persistent inline confirmation |
| Expense line removal | One tap erased input row | Confirm locally before dropping row; no network call |
| Expense sticky footer | Footer could overlap fixed PWA tab bar | Reserve tab bar + Home Indicator height and adjust when keyboard is open |
| Notification inbox | 30s refresh discarded loaded pages, changed scroll position | Merge and de-duplicate recent/older data; preserve old cursor |

## Behaviors intentionally retained

- Successful sign-in / sign-up / group creation / invite acceptance / expense
  submission / settlement creation / expense delete / group archive / logout
  **navigate**: these are expected workflow transitions, not accidental collapse.
- `router.refresh()` still runs after successful server mutations to display
  fresh group membership/financial statuses, without changing the active route.
- Filtering and switching debtor/creditor selection intentionally changes
  matching form controls; it is not a disclosure whose open state is lost.
- Browser Back, closing the app, and changing tabs while editing an unsaved
  expense are **not yet a durable offline-draft flow**. Avoid silently claiming
  these are solved. That requires a separate privacy-aware draft policy.

## Verification

- Unit guard rejects newly introduced `<details>`, `<summary>`,
  `window.confirm` in UI source.
- Notification feed tests cover page preservation and de-duplication.
- HTTP integration covers auth/permissions, rename validation and data
  persistence, archive validation and data persistence, and absence of redirects.
- Run `pnpm lint`, `pnpm typecheck`, `pnpm test:unit`,
  `pnpm build`, `pnpm test:http` on disposable PostgreSQL 17.
- **Real iOS Safari PWA and Android Chrome UI taps need device/browser E2E
  to verify scroll, focus, hydration and native keyboard behavior.**
- Ship to `develop` Preview first. Do not release `main` automatically.
