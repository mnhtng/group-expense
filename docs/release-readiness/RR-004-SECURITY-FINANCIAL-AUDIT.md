# RR-004 — Agent security and financial review, 2026-11-09

**Verdict: local technical verification completed; independent acceptance PENDING; financial release NO-GO.** This is an agent review and executable regression evidence, not approval by the accountable security/finance reviewers. PR #16 was inspected through GitHub: Draft, open, base `develop`, head `41bc3ae39e90d103242f05372902be457aa88209`; no submitted reviews. Nothing was merged, pushed, deployed or activated.

## Scope and financial model

Original obligations are versioned records linked through `obligation_sources` to original invoice items. Snapshot tables preserve source identity and period attribution; a snapshot never becomes a second obligation. Canonical live balances in migration 019 derive `outstanding = original - confirmed CASH - applied NONCASH`, and `available = outstanding - pending CASH`. Pending CASH reserves capacity without extinguishing debt. Two opposite directions in one exact pair must each allocate the same NONCASH offset; no transfer of debt through a third person is introduced.

`proposals.ts`, `decisions.ts`, `applications.ts`, `repayments.ts`, `residual-repayments.ts`, `adjustments.ts`, `disputes.ts`, `reconciliation.ts`, settings/lifecycle services and migrations 011–024 were reviewed with the existing original settlement flow. Financial writers re-evaluate membership, consent, fingerprints and source availability in transactions; group/cycle/head/source locking and database constraints defend retries and competing writers. Actor identity comes from the verified Better Auth session. Ownership/delegation cannot sign for a counterparty. Dispute and bilateral audit/read endpoints filter to the actual pair. Ordinary group-shared invoice balances remain group-shared; this review does not redefine that product policy.

Ingress review includes `proxy.ts`, `lib/security/route-policy.ts`, `lib/auth.ts`, internal Bearer authorization, exact-key JSON validation, direct parameterized SQL and the network-only financial-page Service Worker. Optimistic cookie checks in Proxy do not replace server session checks. Review and tests cover forged/expired cookies, cross-origin mutations, object access, creator-only completion, pair privacy and CSV exports. This is not a penetration-test certification. A point-in-time production-dependency advisory scan is recorded below; it is not a supply-chain certification.

## Findings and disposition

| ID | Finding / risk | Fix and executable evidence |
|---|---|---|
| F-01, high | Cron held a session advisory lock over Neon transaction pooling; checking out a `pg` client did not pin the server session | `BEGIN` + transaction advisory lock retained across work, separate committed audit writes, rollback/discard on release. HTTP test blocks recurring scan, inspects `pg_locks` + `pg_stat_activity`, observes committed running audit, rejects overlap with 202, verifies no remaining lock. Live Neon pooler exercise remains pending. |
| F-02, high | Six legacy audit tables described as append-only allowed direct UPDATE/DELETE | New forward-only migration **024**, local PG17 only: reject UPDATE/DELETE/TRUNCATE on invoice history, completion history, ordinary CASH history, membership history, note history and settings history. Regression attempts all 18 forbidden operations and compares the unchanged rows. Existing SC-005 error contract retained. Fixtures now INSERT historical settings on new synthetic groups; no trigger is disabled to seed audit history. |
| F-03, high | Restore verifier omitted original source details, CASH events, bilateral signatures, snapshot manifests and other tables; JS timestamp conversion erased microseconds; migration checksums alone missed disabled protections | Version-2 digest: **51 public tables + live balances + six schema categories = 58 checks**. PostgreSQL canonical text preserves nested numeric precision and microseconds. Dedicated database test checks full table coverage and detects a one-microsecond difference and disabled trigger. Old partial v1 manifests fail closed. Source/shared destinations rejected. |
| F-04, medium | Regex-only monitor redaction could pass uppercase sensitive text; unbounded JSON body | Explicit product-code allowlist, 64 KiB streaming cap, auth-denial classification even for HTML responses. Unit tests include uppercase token-shaped strings and oversized bodies. Real local protected status endpoint → monitor parser checks 401 and 503. |
| F-05, medium | Successful Cron could hide old pending/expired push deliveries | Aggregate overdue queue count at 30 minutes and alert; invalid/future completion timestamps fail closed. Tests verify classifier boundaries. External alert delivery and operator acknowledgement remain unverified. |
| F-06, medium | PG integration workflow paths omitted settlement-cycle, recurring and internal Cron source | Both push/PR filters now include these directories and recovery/monitor scripts. No hosted workflow was triggered. |

Migration 024 changes protections only. It does not rewrite original obligations, CASH/NONCASH, confirmed events or historical timestamps. It has **not** been applied to any Neon branch. The RR-001 preflight remains pinned to its authorized 001–023 baseline and now reports newer source migrations as pending rather than invalidating old evidence or silently approving them.

## Evidence and limits

The complete final local round used Node 22.23.4 to match Vercel/CI 22.x. See [2026-11-09 local evidence](RR-2026-11-09-LOCAL-EVIDENCE.md) for source identity, exact suites and verification results. Real PG17 tests include 16 two-session cash-allocation races; signed HTTP exercises duplicate/stale requests, mismatched fingerprints, fresh two-party approvals, revocation, applied NONCASH immutability, residual pending/confirmed CASH, disputed-source denial, role/pair privacy, rollback and original-ledger conservation. The independent SC-007 SQL audit runs before/after the HTTP flow and after browsers. Local logical restore compares representative positive finance fixtures; this does not establish managed provider PITR.

## Production dependency advisory scan — 2026-11-09

`pnpm --config.manage-package-manager-versions=false audit --prod --json` scanned the existing locked production dependency graph, **328 dependencies**: **0 critical, 0 high, 1 moderate, 1 low**. Exit code **1** is retained as a non-clean audit, not converted to PASS. No dependency/lockfile was changed.

- **F-07, moderate, unresolved:** `minimatch@10.2.6`, via `shadcn → ts-morph → @ts-morph/common`. [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249) reports glob-pattern amplification; patched version is 11.0.1. A forced cross-major transitive override has not been compatibility-tested or applied.
- **F-08, low, unresolved:** `deepmerge@4.3.1`, via `shadcn`. [GHSA-gcqx-w48m-w2h4](https://github.com/advisories/GHSA-gcqx-w48m-w2h4) reports returned-object prototype poisoning; the advisory currently lists no patched version.

Source search found only the static `shadcn/tailwind.css` import, no application JS imports of these tools. The final Next build's `*.nft.json` traces contain no matching `deepmerge`, `minimatch` or `shadcn` package path. **Inference:** the observed exposure is the declared production dependency/build/tooling graph, with no demonstrated financial-request reachability. This does not establish that attacker input can never reach a future CLI/build invocation. Do not use untrusted registries/glob patterns with this tooling while unresolved; review an upstream-compatible update/removal or record a bounded risk acceptance. Moving packages to devDependencies solely to hide the scan is not remediation.

Independent security review must explicitly dispose of F-07/F-08 before release; neither is claimed fixed or independently accepted.

## Remaining release blockers

1. **Independent reviewers:** accountable finance and security owners must review the actual final source, migrations, test evidence and exception list. No agent PASS can sign for them.
2. **Runtime database authority:** read-only inspection of the isolated Neon connector role showed no superuser flag, but ownership of 51 public tables and CREATE in public. This attests the connector role only; deployed runtime credentials/role were not exported or verified. A table owner can disable triggers. Before release, demonstrate a separate non-owner runtime role without schema CREATE/ALTER/TRUNCATE or audit UPDATE/DELETE, retain a separately held migration role, and rerun role/HTTP tests. Schema hashes are not proof of ACLs, RLS, role memberships or provider policy parity.
3. **Managed restore + monitoring:** historical provider restore, positive managed finance coverage, approved/measured RPO/RTO, external HTTPS fault/alert delivery and named operator acknowledgement remain pending.
4. **Environment drift:** source includes 024; the isolated Neon child still has 23 migrations. Shared databases were not migrated or attested to this new source. Approval and a new child rehearsal are required before certifying 024 on Neon.
5. **Devices and production gate:** physical-device/PWA/accessibility tests are owner-deferred, not passed. The financial engine is hard OFF and production activation/cohort enforcement is not implemented by this change.

**Required human signatures:** security reviewer, finance reviewer and release owner; reviewed SHA or final source digest; date; findings accepted/rejected; explicit residual-risk decisions. All are PENDING. Security signoff must include the two unresolved dependency advisories.
