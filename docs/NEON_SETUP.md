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

The Neon integration is connected and the development database has been initialized. Vercel is connected to GitHub; production is main and the long-lived Preview branch is develop. The Vercel project and environment-variable metadata were inspected through the connected Vercel service; no application secret variables were configured at inspection. Application runtime secrets (two Neon connection URLs, BETTER_AUTH_SECRET) still require setting in Vercel's protected Environment Variables settings. Do not publish these values in GitHub files.

Official references:
- https://neon.com/docs/connect/connection-pooling
- https://neon.com/docs/connect/connect-from-any-app
- https://www.better-auth.com/docs/adapters/postgresql

## Vercel deployment mapping (verified via GitHub, 2026-11-03)

Vercel project: [group-expense](https://vercel.com/mnhtngs-projects/group-expense)
(GitHub repository `mnhtng/group-expense`, Vercel project ID `prj_pBD9UtMAhNGFWh7Qmzskq90lVSC7`).

The Vercel GitHub integration reports:
- `main`: Production deployment succeeded, currently Sprint 0 (`af13caf`).
- `feat/sprint-1-auth-groups-sql`: Preview deployment succeeded, Sprint 1 not merged.
- GitHub status is evidence of a deployment, **not evidence the application can authenticate to Neon**.
- Production branch setting has not been directly read from Vercel project settings. Before merge, confirm `Settings → Environments → Production → Branch = main` in the dashboard.

### Private environment variables (Vercel Settings → Environment Variables)

| Variable | Preview deployment(s) | Production deployment |
| --- | --- | --- |
| `DATABASE_URL` | Development branch pooled endpoint | Production branch pooled endpoint |
| `DATABASE_URL_DIRECT` | Development branch direct endpoint | Production branch direct endpoint |
| `BETTER_AUTH_SECRET` | Strong, stable, Preview-only random secret | Different strong, stable, Production-only random secret |
| `BETTER_AUTH_URL` | Not required when Vercel's URL system variables are exposed; otherwise Preview canonical URL | HTTPS production domain if needed |
| `VERCEL_URL` and `VERCEL_BRANCH_URL` | Enable Vercel system environment variables | `VERCEL_URL` and `VERCEL_PROJECT_PRODUCTION_URL` |

The Better Auth server derives an exact Vercel-host allowlist from deployment environment variables when `VERCEL_URL` is present. This allows the immutable Preview deployment URL and stable branch alias **without allowing every other `*.vercel.app` domain**. During local development, it uses `BETTER_AUTH_URL` (`http://localhost:3000`).

**Important:** Do not put `DATABASE_URL`, `DATABASE_URL_DIRECT`, `BETTER_AUTH_SECRET` in Git, PR text, or `NEXT_PUBLIC_*`. Set secrets on the Vercel project with separate environment scopes, and redeploy the relevant environment after changes. Keep Production pointing at Neon `production`, never the development branch. Do not merge PR #2 until production migrations are reviewed and applied, and Preview sign-up/sign-in/session restoration are tested. The URL strings are retrieved privately from Neon Console and pasted only into the trusted Vercel environment settings.

Official references:
- https://vercel.com/docs/environment-variables
- https://vercel.com/docs/environment-variables/system-environment-variables
- https://better-auth.com/docs/guides/dynamic-base-url

## Git workflow: production and preview (2026-11-03)

| GitHub branch | Vercel target | Neon target | Purpose |
| --- | --- | --- | --- |
| `main` | Production | `production` | Release only after review and production migration |
| `develop` | Preview | `development` | Shared QA and integration testing |
| `feat/*` | Preview deployments | Isolated / development only if explicitly scoped | Feature PRs target `develop` |

The primary Sprint 1 PR targets `develop` (not `main`). CI runs for pushes to both branches, plus PRs. The PostgreSQL integration workflow also runs on `develop` pushes. Before a production release, open a separate PR from `develop` to `main`, run database migrations safely, and verify the production deployment.

**Preview secrets must be scoped to the `develop` Git branch** where possible. Do not route another branch's Preview or any production deployment to Neon development by accident. Vercel environment variables must not be committed into Git.
