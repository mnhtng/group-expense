# Sprint 0 — Repository audit

**Observed:** 2026-11-02; `mnhtng/group-expense`, `main` at
`0d496d1b1a88651bbf4a97ef6a9f1ce51858f75a`.

| Area | Observed state | Decision |
|---|---|---|
| Framework | Next 16.4.3, React 19.3, root App Router `app/` | Keep; check local Next 16 docs |
| Package manager | pnpm 10.17.1 and tracked lockfile | Keep; no manual lockfile edits |
| UI | Tailwind v4, shadcn v4, Base UI, base-maia, Hugeicons | Reuse existing theme/components |
| Pages | `app/page.tsx` initially displayed "Init" | Preview mobile-first 4-tab shell |
| DB | No client, SQL schema or migrations | Sprint 1 uses PostgreSQL + `pg` + SQL |
| Auth | Not installed | Evaluate direct-PostgreSQL Better Auth (no ORM) |
| PWA | No manifest or icons | Add manifest + SVG icon scaffold |
| CI | Existing lint/typecheck/build scripts | Add Node unit tests + GitHub Actions |

## Decisions

1. Keep the existing initialized Next.js project; no duplicate app/rewrite.
2. No ORM or ORM adapters; financial data via parameterized SQL and `pg`.
3. Money uses `bigint` for integer VND; serialize strings over JSON.
4. Item shares must trace to obligations, settlement allocations and immutable events.
5. Settlements require counterparty confirmation. Pending requests do not reduce debt.
6. Long-lived server-managed login (proposed sliding 365-day/24-hour refresh);
   HttpOnly/Secure cookie, explicit logout/revoke. Cookies can still expire or be cleared.
7. No sensitive data in service-worker cache; installability and push come after auth.
8. Changes go through a feature branch/PR; never change `main` without review.

## Limitations of this increment

- Preview UI and PWA manifest only; no user data, auth, database, push, or settlements.
- Pure money unit tests verified separately on Node 22.
- `pnpm lint`, `pnpm typecheck` and `pnpm build` must run on CI
  because dependencies were unavailable in the execution container.
- Next.js `AGENTS.md` instructs checking `node_modules/next/dist/docs/`
  before changing APIs; must follow once dependencies are installed.

See [implementation roadmap](IMPLEMENTATION_PLAN.md).
