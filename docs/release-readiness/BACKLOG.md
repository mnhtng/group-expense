# Release Readiness — gated verification backlog

**Feature branch:** `feat/settlement-cycles-bilateral` → Draft PR #16 against `develop`.
**Scope:** verification and operational assurance **after** SC-010, not new settlement features.
**Release status:** **NO-GO**. `SETTLEMENT_CYCLE_ENGINE_READY=false` is immutable for this track.
**Protocol:** one RR ticket per conversation; collect evidence against the exact commit SHA before changing the next gate.

## Existing implementation

SC-001–SC-010 and BN-001–BN-006 are implemented on the feature branch. PostgreSQL 17 disposable CI, HTTP tests, original-ledger audits and SC-010 logical restore pass. They do **not** establish managed Neon restore capability, real-device correctness or permission to release financial changes.

## Backlog and gates

| Ticket | Priority | Goal | Exit criterion | Status |
|---|---|---|---|---|
| **RR-001** | P0 | Isolated Neon migration 011–023 rehearsal | Confirm exact isolated child and credential endpoints; record pre-migration source hashes; separately authorize 011–023 *on that child alone*; verify migration idempotency and checksums; reconcile original balances/provenance and parent immutability; independent permission/HTTP and restore gates follow separately | **SCHEMA PASS — all 011–023 applied on isolated child, 23/23 checksums and 8/8 read-only financial audits; release remains NO-GO** |
| **RR-002** | P0 | Browser and mobile real-interaction E2E | Chromium + WebKit, iOS installed PWA and Android; consent, focus, stale proposal, error, offline, deep links, bilateral privacy and 44px touch; artifacts and regression list | **LOCAL AUTOMATED BROWSER PASS 4/4 (2026-11-07)** — full signed Chromium, WebKit, emulated iPhone and Android Playwright flow passed on disposable PG17; physical iOS/Android installed PWA, representative real-device accessibility/keyboard, and final reviewed-SHA signoff still pending; **overall NO-GO** |
| **RR-003** | P0 | Recoverability and operations alerting | Authorized provider backup/PITR restore into new independent Neon branch; independent immutable-source reconciliation, declared RPO/RTO, verified authenticated 503/alert response path, operator acknowledgement | NOT STARTED |
| **RR-004** | P0 | Independent security and finance signoff | Full original + confirmed CASH + NONCASH + pending conservation, source-link accuracy, disputed-source denials, roles, concurrency, secrets, threats and documented review by accountable humans | NOT STARTED |
| **RR-005** | P1 | Staging and staged-release decision | Only after RR-001..004 pass, separate explicit approval for staging migrations/deployment and production release; test rollback without ledger reversal; reviewed commit SHA; controlled opted-in 1→5→25 cohort | BLOCKED / NOT AUTHORIZED |

## Non-negotiable constraints

1. **No changes to original obligation ledger, CASH/NONCASH allocations or immutable snapshots in readiness tooling.** No synthetic bank transfer.
2. **No ORM.** Keep PostgreSQL through the existing `pg` driver and versioned SQL migrations.
3. No automatic merge, staging or production deployment, shared-Neon schema change, feature flag activation or project-wide secret export.
4. The SC-010 disposable PG17 restore script is **never** run on Neon.
5. Financial data reads must be isolated and role-limited. Do not log credentials, member identities, invoice descriptions or payment amounts in operational telemetry.
6. An isolated Neon schema write requires a **separate explicit authorization identifying RR-001 migrations 011–023 and branch ID**; generic "continue" is not enough.
7. Do not claim release-ready from a green CI or a read-only Neon baseline. Each gate needs independent evidence and human signoff.
8. The SC-010 runbook remains canonical for recovery and staged rollout: [SC-010](../settlement-cycles/SC-010-OPERATIONS-ROLLOUT.md).

## RR-001 execution evidence (isolated Neon, 2026-11-05)

- Neon project: `withered-salad-00928018` (`group-expense`).
- Isolated child: `br-curly-rice-b3xenws6` (`sc010-rehearsal-20261105`).
- Parent: `br-dry-poetry-b31cudmb` (`development`).
- Production: `br-round-salad-b39y4yce` (**excluded**).
- Before migration, child and parent both had **10** migrations with empty schema diff. **After migration, child has 23**, parent retains 10 and production retains 6; child-parent schema diff is nonempty as expected.
- Baseline child: **2** original expenses, **2** obligations. Values and identity-bearing rows are deliberately not published in repository docs.
- The child PostgreSQL 17 compute was found; endpoint host pair is pinned to that **one** child in `db/rr001-neon-preflight.mjs`. The checker rejects all other project, branch, database, host, role or TLS combinations before connecting.
- **All migrations 011–023 were executed in ordered, advisory-locked transactions on the child only.** SHA-256 of all 23 installed migrations matches the exact pinned GitHub SQL. The complete original `expenses`/`obligations` source-row hashes are unchanged, and all 8 SC-007 independent read-only financial reconciliation queries return zero violations.
- **Evidence and limits:** [RR-001-NEON-MIGRATION-EVIDENCE.md](./RR-001-NEON-MIGRATION-EVIDENCE.md). The exact `pnpm db:migrate` CLI was not run on Neon; equivalent SQL was applied through the branch-pinned Neon connector. No managed Neon PITR restore or authenticated browser E2E occurred. This child has no applied noncash document; positive multi-party scenarios remain verified by disposable PG17 CI.
- The existing engine remains OFF; PR #16 must remain Draft.

## RR-001 reproducibility and handoff

- Unit validation: `node --test tests/rr001-neon-preflight.test.mjs`.
- Operator read-only DB preflight, only after securely provisioning branch-specific `DATABASE_URL`, `DATABASE_URL_DIRECT`, `RR001_PROJECT_ID` and `RR001_BRANCH_ID`: `node db/rr001-neon-preflight.mjs`.
- Without those values it fails closed and cannot connect. Passwords and URLs must **never** enter Git.
- The isolated Neon schema rehearsal has been separately authorized and executed. **Do not reapply SQL 011–023 manually or migrate shared branches.** A later CLI idempotency demonstration may use only the already-migrated isolated child with branch-specific credentials, after re-verifying its current schema; the 23 exact checksums already prove that the ordinary migrator would skip these migration files. Do not treat this as RR-003 backup/restore certification.
- RR-002..005 are deliberately **not implemented** under RR-001.

## RR-002 implementation and verification status (2026-11-05)

- Real browser E2E: `tests/rr002-browser.e2e.mjs` using Chromium desktop, WebKit desktop, iPhone 13 WebKit emulation and Pixel 7 Chromium emulation against disposable localhost PG17 only.
- Dedicated CI: `.github/workflows/rr002-browser-e2e.yml`; fail-closed static checks: `tests/rr002-safety.test.mjs`. The original obligation invoice link touch height was adjusted to 44 CSS px.
- Latest browser source includes a bounded retry respecting Better Auth HTTP 429 rate limiting, **without weakening production auth**.
- [Evidence, execution attempts and outstanding physical-device gates](./RR-002-BROWSER-E2E.md). **Local automated browser matrix is now PASS 4/4 (2026-11-07)**; the earlier Better Auth/Actions failures remain historical. Do not mark the full RR-002 device/release gate DONE until physical iOS/Android/PWA and reviewed-SHA evidence are complete.
- The source of truth for financial release remains `SETTLEMENT_CYCLE_ENGINE_READY=false`. PR #16 Draft. No staging/prod migration, finance engine activation or shared-Neon mutation.

## RR-002 local cross-browser verification — 2026-11-07

Owner-provided local log evidence: focused WebKit desktop `tests 2, pass 2, fail 0`; complete four-profile matrix `tests 5, pass 5, fail 0` (Chromium desktop, WebKit desktop, iPhone WebKit emulation, Android Chromium emulation; four subtests + parent). Loopback-only disposable Docker PostgreSQL 17 migrations 001–023 passed; repeat migration verification skipped reapplying; Next.js 16.4.3 production build and TypeScript passed. Actual browser tested consent/stale-409/lock, source pagination, private pair disputes, controlled network failure/retry and no finance-money mutation.

**Distinguish levels:** `RR-002 local automated E2E = PASS` is not `RR-002 physical-device/release gate = PASS`. Real iPhone/Android and installed PWA testing, accessibility/keyboard signoff, exact Mac commit SHA capture and final CI/HTTP/integration evidence remain outstanding. The supplied terminal log did not contain `git rev-parse HEAD`; don't claim exact source SHA was authenticated. Hosted Actions are still constrained by quota. Keep RR-003/004/005 pending and release NO-GO. Detailed [RR-002 evidence](./RR-002-BROWSER-E2E.md).

## RR-002 device-gate preparation — 2026-11-07

Following the verified previous 4/4 local browser PASS, the feature branch adds a keyboard-only Space/Tab/Enter snapshot-confirmation regression for desktop Chromium/WebKit, a real browser response assertion for phone pointer confirmation, and a local runner report containing Git SHA, tracked-tree cleanliness and exact test profile scope (`rr002-artifacts/rr002-local-result.json`, only after successful tests). These additions have **not yet been rerun** on Mac, so the prior 4/4 evidence must not be attributed to the new SHA.

The [physical iOS/Android + installed-PWA protocol](./RR-002-PHYSICAL-DEVICE-ACCEPTANCE.md) defines 18 hardware acceptance cases and requires a separately approved isolated HTTPS deployment with synthetic-only data. **No device test or deployment has been performed; physical RR-002 remains PENDING.** A direct Mac LAN URL using HTTP is not a substitute for a secure-context installable PWA. Do not enable finance engine or write to shared Neon.

## RR-002 keyboard extension — native macOS WebKit Tab policy (2026-11-07)

Owner-provided local run on clean tracked SHA `a9330eda742bdc3993e2a34478301acb06666cd3`: migration 001–023 twice and Next.js/TypeScript **PASS**; Chromium desktop, iPhone WebKit emulation, Android Chromium emulation **PASS**; WebKit **desktop failed** at the newly added plain-Tab-focus assertion, before pressing Enter or writing snapshot (`tests 5 / pass 3 / fail 2`, counting failed parent). The former full 4/4 browser suite PASS was from an **earlier test implementation**, so it does not prove the added keyboard test.

Playwright [#41808](https://github.com/microsoft/playwright/issues/41808) documents macOS WebKit skipping native buttons on plain Tab when the OS Keyboard Navigation preference is off; [WebKit #199671](https://bugs.webkit.org/show_bug.cgi?id=199671) identifies Option+Tab as the Safari-compatible navigation gesture. The test now requires real focus after Tab, or on **macOS WebKit desktop only** retries the native **Option+Tab** route from the same checkbox and requires focus, Enter, actual HTTP 200 and unchanged financial balances. No product UI/API or ledger changes, no synthetic click, no forced focus, no OS-preference mutation. **Not yet rerun on the updated commit.**

Physical-device/PWA signoff, exact final verified SHA, RR-003/004/005 and production release authorization remain pending; engine hard OFF, PR #16 Draft.

## Limited GitHub Actions minutes — cost triage (2026-11-06)

**Owner-confirmed constraint:** GitHub Actions usage quota exhausted. Until capacity returns, **do not repeatedly trigger or pay to retry runners**. This is a resource constraint, not proof that the current RR-002 Playwright suite has passed.

| Verification | Now | Required before financial release |
|---|---|---|
| Every-commit, 4-profile Chromium/WebKit/mobile-emulated RR-002 matrix | **SKIP automation**: opt-in PR label `run-rr002-e2e` only; no billed runner on ordinary push | An independently observed passing interaction E2E for Chromium and WebKit; representative mobile browser |
| Local browser interaction / signed auth / pair privacy / stale 409 / consent | **RUN locally** on disposable PG17 via `bash scripts/rr002-local.sh` | PASS with evidence for real signed flows, including original ledger unchanged |
| Extra screenshots, repeated visual baselines and mobile emulation variants | Defer while feature engine remains OFF | Representative screenshot and user-visible accessibility/44px checks; broaden if product supports more devices |
| Full physical iOS/Android installed PWA testing | Defer if no release planned | Real device acceptance, session/storage, keyboard/touch and offline/recovery as supported |
| Basic typecheck, unit, DB/HTTP financial integrity, two-party authorization and concurrency | **NEVER WAIVE**: run locally as needed; green prior CI on earlier SHA does not certify current SHA | PASS at final reviewed code SHA |
| Neon backup/PITR restore (RR-003), security/finance signoff (RR-004), staging/rollout (RR-005) | **DEFER** until release is actively being planned | **REQUIRED** in order, each independently approved and evidenced |

The costly RR-002 PR workflow is now `pull_request: types: [labeled]`; only adding label `run-rr002-e2e` starts its 4-profile matrix. It also retains `workflow_dispatch`, which GitHub only makes available after the workflow exists on the default branch. The normal CI and PG17 integration workflows were **not weakened** because they are part of the financial safety gates. See [RR-002 runbook](./RR-002-BROWSER-E2E.md). Local E2E setup requires Docker, Node.js 22+, pnpm, npm, and a free port `127.0.0.1:5432`; it never connects to Neon or shared local PostgreSQL.

**Readiness:** RR-001 schema rehearsal PASS, RR-002 **local automated browser E2E PASS 4/4** but physical-device/release gate PENDING, RR-003/004/005 pending. Overall financial production release remains **NO-GO**, engine hard OFF, PR #16 Draft.
