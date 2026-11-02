# Group Expense

Mobile-first PWA for group expenses, itemized receipts, traceable debts and
**two-party confirmed** repayments.

> **Stage:** Sprint 0 foundation. The 4-tab UI is a preview, not an operational
> expense system; authentication, PostgreSQL, expenses, settlements and push
> notifications are not yet implemented.

## Stack

- Next.js 16.4.3 / React 19.3 / TypeScript / pnpm 10.17.1
- Tailwind CSS 4, shadcn/ui, Base UI, Hugeicons
- Planned: PostgreSQL + `pg` + parameterized SQL and versioned SQL migrations.
  **No ORM.**
- Planned: long-lived database sessions and PWA notifications.

## Development

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

Visit http://localhost:3000.

## Checks

```bash
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm build
```

Money helpers calculate VND in integer `bigint` minor units and have unit tests.

## Docs

- [Roadmap](docs/IMPLEMENTATION_PLAN.md)
- [Repository audit](docs/REPOSITORY_AUDIT.md)
- [Database guidelines](db/README.md)

Do not commit secrets. All financial mutations must authorize the actor at the
server and record transactions with audit events.
