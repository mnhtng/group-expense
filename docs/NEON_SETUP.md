# Neon Postgres + Better Auth configuration

**Status (2026-11-03):** Neon connected. Dedicated project created and development schema provisioned. Production branch remains untouched. Hosting environment secrets are not configured yet.

## Provisioned environment (no credentials)

| Setting | Value |
| --- | --- |
| Neon project | `group-expense` |
| Project ID | `withered-salad-00928018` |
| Region | `aws-ap-southeast-1` (Singapore) |
| PostgreSQL | 17 |
| Production branch | `br-round-salad-b39y4yce` (schema unchanged) |
| Development branch | `br-dry-poetry-b31cudmb` |
| Development database | `group_expense` |
| Role | `group_expense_owner` |
| Runtime pooled host | `ep-twilight-shadow-b3iwg7oz-pooler.c-4.ap-southeast-1.aws.neon.tech` |
| Migration direct host | `ep-twilight-shadow-b3iwg7oz.c-4.ap-southeast-1.aws.neon.tech` |

The development compute has PgBouncer pooling enabled. The migrations `001_auth.sql` and `002_groups.sql` were applied transactionally to **development**; eight expected tables exist. `schema_migrations` holds both SHA-256 checksums (64 characters), matching the migration files through PostgreSQL's SHA256 calculation. The PostgreSQL integration workflow continues testing separately against an ephemeral CI Postgres instance.

Actual connection URLs, database passwords and Better Auth secrets are **not** stored in the repository. The GitHub integration here cannot write Actions secrets. Set development/runtime URLs through your app deployment provider's private environment settings; do not put them in GitHub source or in issues/PR descriptions.

## Architecture

- **Runtime:** Next.js and Better Auth share `lib/db/pool.ts`, which uses `pg.Pool` and `DATABASE_URL` (Neon's **pooled** URL).
- **Migrations:** `db/migrate.mjs` uses `DATABASE_URL_DIRECT` (Neon's **direct** URL). A Neon migration without a direct URL is rejected to avoid accidentally running schema operations on the pooler.
- **Better Auth:** Self-hosted Better Auth with its built-in PostgreSQL/Kysely adapter, **not Neon-managed Auth**. Business queries remain hand-written parameterized SQL through `pg`; Prisma/Drizzle are forbidden.
- **TLS:** Both Neon URLs must have `?sslmode=require` (or stronger). Never disable certificate verification.
- **Environments:** Prefer separate Neon development and production database branches. Do not migrate production while experimenting with PRs.

## Steps after Neon connection is granted

1. In Neon, select or create a **development** project and branch for `group-expense`.
2. Obtain both pooled and direct connection strings for the **same role, branch and database**. Store them in private environment configuration, not Git.
3. Set:
   - `DATABASE_URL`: pooled URL, host containing `-pooler`.
   - `DATABASE_URL_DIRECT`: direct URL, host without `-pooler`.
   - `BETTER_AUTH_SECRET`: unique cryptographically generated random string, at least 32 characters, retained across deployments.
   - `BETTER_AUTH_URL`: actual application origin (local http origin while developing, deployed https origin in production).
4. Run `pnpm install --frozen-lockfile`, `pnpm db:neon-check`, then `pnpm db:migrate` **on the development branch**.
5. Check resulting tables: `user`, `session`, `account`, `verification`, `groups`, `group_members`, `group_invites`, `schema_migrations`. Running migrations again must make no changes.
6. Test registration, sign-in, sign-out, membership, invitations and account isolation with test users. Use a separate staging environment for the tests; do not create test users in the production branch.
7. Only when staging validations pass, approve production migrations and configure the production hosting provider with **its own** URLs and secret.

## Safe commands

```bash
cp .env.example .env.local
# Edit .env.local locally with your actual (private) URLs and generated secret.
pnpm install --frozen-lockfile
pnpm db:neon-check   # read-only health check, direct URL
pnpm db:migrate      # schema writes, direct URL
pnpm db:check        # read migration history, direct URL
pnpm test:unit
```

The PR CI integration tests deliberately use an isolated PostgreSQL 17 service, **not** a live Neon database. Running SQL migrations against an unreviewed production database from a pull request is prohibited.

## Hosting considerations

- `pg.Pool` runs under Node.js, **not Edge Runtime**; deploy the app to a provider offering Node.js server-side execution.
- Use pooled connections for request traffic to minimize PostgreSQL connection churn, a small per-instance pool (configured to 5) and short query timeouts.
- Keep Better Auth's long-lived DB-backed session with `HttpOnly` cookies; user can remain signed in for 365 days while active sessions renew every 24 hours. Cookie clearing, security revocations or idle expiry can require sign-in again.
- On Neon free/scale-to-zero instances, the first cold query may take longer. Test signup and protected navigation during wake-up.
- Do not expose any connection string to the browser (`NEXT_PUBLIC_*`); avoid leaking DB credentials in build logs, errors, or commits.

## Verification and blockers

The Neon integration is connected and the development database has been initialized. A deployment platform has not been connected, so application runtime secrets (two Neon connection URLs, BETTER_AUTH_SECRET, BETTER_AUTH_URL) still require a trusted destination. Do not publish these values in GitHub files.

Official references:
- https://neon.com/docs/connect/connection-pooling
- https://neon.com/docs/connect/connect-from-any-app
- https://www.better-auth.com/docs/adapters/postgresql
