# Security middleware architecture — Next.js 16.4 + Better Auth 1.7.7

This project uses **Next.js 16 `proxy.ts`**, not the deprecated
`middleware.ts` file convention.

## Request pipeline

```
Browser → Next Proxy (routing, cookie presence, Origin/Fetch Metadata, headers)
        → Next Route Handler / Server Action / Server Component
        → Better Auth verified DB session (withAuthenticatedApi or requireUser)
        → Service authorization (membership, role, ownership, row-level scopes)
        → Parameterized PostgreSQL SQL / transaction / audit events
```

### Layer 1 — `proxy.ts`

- Public: `/`, `/sign-in`, `/sign-up`, `/invite/:token`.
- Better Auth endpoints: `/api/auth/:path*` are handled by Better Auth itself.
- Internal cron: **only** `/api/internal/push-drain` bypasses session checks;
  the handler requires a separate constant-time validated `CRON_SECRET`.
- Protected: other pages and `/api/:path*`. New app paths default to protected.
- Anonymous page requests receive HTTP 307 to `/sign-in?returnTo=...` (local only).
- Anonymous API requests receive JSON HTTP 401, never an HTML login redirect.
- Authenticated cookie API writes require exact same-origin `Origin` and reject
  `Sec-Fetch-Site: cross-site`. This intentionally rejects non-browser
  mutation requests that omit `Origin`, even if they send a cookie.
  Add `Origin: <same API origin>` when using curl or integration-test clients.
- Security headers: nosniff, frame DENY, strict-origin-when-cross-origin,
  disabled camera/microphone/geolocation. Private responses have `no-store` and
  `Vary: Cookie`.
- Static assets, service worker, offline fallback and manifest bypass Proxy.
  All API paths still match even when the name contains a period.

**Important:** A cookie existing is NOT session verification.
Proxy never grants access to a user or a financial resource.

### Layer 2 — server/session

- The DB-backed Better Auth session is verified via `getCurrentSession()`.
- Pages use `requireUser()`, and the authenticated app layout checks session.
- API handlers can use `withAuthenticatedApi()` in
  `lib/security/api-guards.ts` to eliminate duplicated session checking,
  attach no-store headers and consistently produce JSON 401.
- `/sign-in` uses `safeReturnTo` to prevent open redirects.
- Existing other financial APIs still verify session explicitly; migration to the
  shared wrapper can be incremental without weakening authorization.
- **Server Actions are not trusted based on Proxy**; they call `requireUser`
  and service methods, and Next.js verifies their Origin.

### Layer 3 — entity authorization and atomic business operations

- Group membership/role must be checked by the service (e.g.
  `getMemberRole`, `getGroupDetails`, `listGroupDebts`).
- Expense mutations verify creator/owner/admin and revision, and guard
  settled/confirmed obligations. Settlement state transitions require the
  **counterparty** and use database locking. Notification reads/writes are scoped
  to recipient. The proxy cannot grant these permissions.
- Never trust a `groupId`, `userId`, role, or token from a client header.
  Use the identity resolved from the verified session.
- No ORM. No database migration is required for this change.

## Regression testing

Run `pnpm lint`, `pnpm typecheck`, `pnpm test:unit`,
`pnpm build`, and PostgreSQL `pnpm test:http` in GitHub Actions.

The tests cover route classification, malicious returnTo, cross-origin writes,
forged cookies, anonymous APIs/pages, authorized Better Auth sessions,
group CRUD and confirmed settlement paths.

## Exclusions and future hardening

- No memory-only per-instance rate limiting: it is not reliable under serverless.
  Introduce an external shared limit store (e.g. Redis) before claiming global
  login/IP request quotas.
- No blanket Content Security Policy is installed; strict CSP needs a nonce-aware
  Next.js/React rollout and browser testing.
- Existing Better Auth endpoints own their CSRF and brute-force protections.
- Do not use Proxy as a substitute for server authorization or audit logs.
- Preserve `main` production until Preview CI and manual flows are verified.
