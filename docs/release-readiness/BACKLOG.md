# Release Readiness — gated verification backlog

**Mobile redesign, 2026-11-11:** implemented locally on `feat/mobile-design-system`, inspired by Tricount: larger type, plain Vietnamese and separate task screens. [Design system](../design/MOBILE-DESIGN-SYSTEM.md); [verification](../design/MOBILE-REDESIGN-VERIFICATION.md). Production build,182 unit tests, HTTP, eight local finance audits and four browser profiles PASS. This UI branch has not been pushed/deployed; the managed receipts below describe the earlier deployed financial release.

**SC025 implementation and approved deployment complete:** owner requested real financial paths and
bounded group rollout. [SC025 implementation/verification](../settlement-cycles/SC-025-CONTROLLED-ACTIVATION.md)
replaces the old constant-OFF architecture with operator-only, default-OFF database
policy. Owner-approved rehearsal025 and the hosted synthetic financial flow PASS;
staging/production schema25, limited roles and application rollout PASS through
PR21/22. No real-group enrollment.
[Current managed receipts](SC-025-MANAGED-EVIDENCE.md) supersede the pre025
application receipts below; staging/production remain OFF with empty cohorts.

**Application PRs:** [PR21](https://github.com/mnhtng/group-expense/pull/21) feature→develop and [PR22](https://github.com/mnhtng/group-expense/pull/22) develop→main, merged.
**Scope:** settlement implementation plus verification/operational assurance after SC-010; earlier dated entries remain historical.
**Application release:** schema25/application/runtime verification PASS on staging and production. **Real-group financial activation: NO-GO**, database policy OFF, empty cohorts; independent/device/ops/recovery gates remain open. [Completed SC025 receipts](SC-025-MANAGED-EVIDENCE.md). [Earlier application-only release](RR-005-RELEASE-EXECUTION.md).
**Latest financial authorization:** approved the entire [SC025 execution package](SC-025-MANAGED-EXECUTION.md), including isolated synthetic finance and subsequent staged deployment. It does not certify remaining gates or admit real groups. Email remains deferred.
**Protocol (owner request, 2026-11-09):** continue safely across RR-003–005 in one task; preserve separate approval boundaries for provider mutations, shared migrations, deployment, activation and independent signoff. Bind evidence to a clean commit or explicitly identified working-tree code digest.

## Existing implementation

SC-001–SC-010, BN-001–BN-006 and SC025 are implemented and deployed. Source digest `c440984adbc97b16f6837d292aca060edff5848943ffc3da5e3ef3f00ef360ae`:182 unit,13 PG17 integration, limited-role production build/HTTP, four active browser profiles and61 restore comparisons PASS. Managed synthetic finance and both deployed limited roles also PASS. This does not certify physical devices, independent human signoff, full-service recovery or real-group rollout.

## Backlog and gates

| Ticket | Priority | Goal | Exit criterion | Status |
|---|---|---|---|---|
| **RR-001** | P0 | Authorized isolated migration rehearsal | Exact branch/list/checksums, idempotency, original-data preservation and financial audits | **SCHEMA PASS** — separately approved025 on rehearsal/staging/production;25 hashes,42 original business relations preserved and8 zero audits per target. Historical011–024 evidence retained below |
| **RR-002** | P0 | Browser and physical-device interactions | Chromium/WebKit plus real iOS/Android installed PWA; consent/focus/privacy/offline/accessibility/44px targets | **LOCAL BROWSER PASS4/4,2026-11-10** — real signed browser controls also exercise admitted-group proposals, revocation/new version, dual approval, NONCASH and residual CASH. Physical devices/installed PWA acceptance remain pending |
| **RR-003** | P0 | Recovery and operations alerting | Managed historical restore, positive financial preservation, service RPO15m/RTO60m, external monitor/ack/recovery | **PARTIAL PASS** — historical PITR58/58; SC025 positive managed finance/42 original-business comparisons/eight audits PASS. Production status200/empty alerts; staging503 only NO_COMPLETED_CRON_RUN. Positive-fixture PITR/full-service RPO-RTO and external non-email delivery/ack remain pending |
| **RR-004** | P0 | Independent security and finance signoff | Source/financial invariants/permissions/advisories reviewed by accountable humans | **TECHNICAL PARITY PASS** — actual isolated/staging/production roles56 objects/29 guards, scoped writes/conservation/idempotency PASS. Independent human security/finance signoff remains pending |
| **RR-005** | P1 | Application and observed real-group rollout | Staging→production, schema-compatible rollback, explicit pilot1→5→25 and observation | **APPLICATION DEPLOYED/VERIFIED** through PR21/22, schema25 and bounded default-OFF policy. Initial025 builds attest as compatible runtime candidates; actual managed rollback and observed real-group rollout remain unperformed. Shared cohorts empty |

## Non-negotiable constraints

1. **Never rewrite existing original financial/audit records.** New synthetic financial documents were authorized only on the named isolated rehearsal; none on staging/production. No synthetic bank transfer.
2. **No ORM.** Keep PostgreSQL through the existing `pg` driver and versioned SQL migrations.
3. Publishing, provider changes and merge/deploy follow the exact owner-approved [SC025 package](SC-025-MANAGED-EXECUTION.md); real-group activation remains separate. No project-wide secret export.
4. The SC-010 disposable PG17 restore script is **never** run on Neon.
5. Financial data reads must be isolated and role-limited. Do not log credentials, member identities, invoice descriptions or payment amounts in operational telemetry.
6. An isolated Neon schema write requires **separate explicit authorization naming the exact migration list and branch ID**; generic "continue" is not enough. Historical RR-001 approval covers only 011–023 on its original child, not 024 or the recovered child.
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

## RR-002 latest verified source-bound E2E PASS — 2026-11-07

**Complete and verified for local automated browser testing at clean-tracked SHA `5daf6e8e0ca5b0344d0d76896ca02266f06baf5e`** (as reported in the local runner and generated local JSON): focused macOS WebKit desktop `2/2` Node tests PASS; default full matrix `5/5` PASS (four profiles: desktop Chromium, desktop WebKit, emulated iPhone, emulated Android; plus parent), PostgreSQL 17 migrations 001–023 + idempotency and Next.js build/TypeScript PASS. The keyboard `Space → Tab / native macOS WebKit Option+Tab → Enter` test and actual HTTP 200 are included. Machine-readable metadata reports `fullBrowserMatrix=true`, `sourceState=clean-tracked`, `physicalDevicesTested=false`. This **supersedes older keyboard/WebKit failure evidence** for the tested SHA.

**Gate split:** Local RR-002 automated browser scope **PASS**, but physical Safari/Android/installed PWA/real keyboard/VoiceOver/TalkBack signoff **PENDING**. No new physical device result, managed Neon PITR, full unit/HTTP/integration retest on this exact SHA, or independent financial signoff is claimed. GitHub Actions quota still limits hosted verification. Overall release **NO-GO**, engine OFF, Draft PR #16. [Exact SHA evidence details](./RR-002-BROWSER-E2E.md).

## RR-003 provider read-only baseline and recovery-tool scaffold — 2026-11-07

Owner requested to proceed to RR-003 without waiting for physical-device tests. **The physical RR-002 gate is deferred by owner for current development, NOT marked PASS or waived as a production release requirement.** Local source-bound four-browser RR-002 is PASS on `5daf6e8e0ca5b0344d0d76896ca02266f06baf5e`.

**Read-only live Neon inspection:** project `withered-salad-00928018` PostgreSQL 17 `free_v3`, `history_retention_seconds=21600` (6 hours); three branches (default production, shared development, and isolated RR-001 child); `list_snapshots=[]` and schedule empty on all three inspected branches. SQL on **isolated child only** returned 23 installed migrations, 2 original expenses, 2 obligations, 0 operational run rows, no financial row content. No live data or source parent modified. Lack of a snapshot does not establish timestamp PITR unavailability; neither PITR nor external alert delivery has been exercised.

**Implemented safety preparation:** `db/rr003-recovery-policy.mjs` + fail-closed unit tests, `db/rr003-restore-compare.mjs` + unit tests (15 financial hash classes, TLS exact branch host guards, READ ONLY transactions, no real restore), `scripts/rr003-ops-monitor.mjs` + tests (approved HTTPS bearer-only GET, redacted 200/503/401 and hard-OFF checks), local recovery baseline ignored by Git, and [RR-003 operations/recovery runbook](./RR-003-RECOVERY-DRILL.md). Provider restore, new branch creation, source/restore conservation comparison, live HTTPS monitor, alert acknowledgement, and declared/measured RPO/RTO are **PENDING separate explicit operational approval**. Code static parsing/pure policy checks were inspected, but Node unit/SQL/HTTP integration suites on the new SHA have not been run. RR-003 remains **NO-GO**.

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

## Current takeover — 2026-11-09

**Current continuation supersedes the initial observations below:** [source-bound results](RR-2026-11-09-CONTINUATION-EVIDENCE.md), [managed PITR receipt and limits](RR-003-MANAGED-PITR-EVIDENCE.md), [restricted runtime profile](RR-004-RUNTIME-ROLE.md). Baseline fixes were committed locally as `16fba847df1bab7b2ef9b31dd3e0e582724b2771`; the next verified code digest is `359eebf5ac4fab9b87ad80b8fd49f139ee99c5f05780aec1a10633fbb18eaf26`.

**171 unit + 11 PG17 integration tests PASS**, including genuine non-owner TCP login/SQL denials. Both ordinary and restricted runtime profiles pass build, signed HTTP and all four browser profiles. The owner-approved Free-only PITR created one historical child from the isolated source; snapshot API rejected the non-root source, so the actual successful operation was timestamp-based historical branching, not snapshot restore. At the pre-024 PITR capture, all 58 source/restore digests matched; source remained unchanged, and both branches passed all eight independent finance audits. Four branches remain within the reported Free limit ten; new compute was observed idle. No shared migration, push, deployment or activation occurred.

The owner subsequently approved **024 only on recovered child `br-noisy-river-b3ajidmw`**. It now has **24/24 matching migration checksums**, 12 enabled audit triggers, 55 unchanged digest classes and exactly three expected schema/log changes. Repeat is a 58/58 unchanged no-op; all eight financial audits pass. Source remains at **23**, with 58/58 unchanged hashes. See [024 managed migration evidence](RR-001-024-NEON-MIGRATION-EVIDENCE.md). Runtime least-privilege grants are implemented and fully exercised locally, not installed or certified on a deployed Neon login. Dependency remediation removes the moderate minimatch finding and patches the reproduced deepmerge defect; the registry still reports **one low** upstream advisory, with independent patch/risk acceptance pending. External monitor delivery/operator acknowledgement, service RPO/RTO, positive managed finance fixtures, physical-device acceptance and independent human signatures remain unresolved. **Release NO-GO; PR Draft; engine OFF.**

### Runtime/alert continuation and owner decisions

**Latest scope decision — 2026-11-09:** the owner requested skipping email. Mail provisioning, API-key setup and further mail drills are **DEFERRED BY OWNER**, with no domain/account action requested. Retain the Free Resend installation with zero connected projects; no named resource or key was created. Generic HTTPS monitoring/outbox code remains. Hosted external alert delivery/scheduling and full-service recovery acceptance remain open; this deferral does not certify RR-003 or authorize a replacement service.

The next source adds a protected runtime attestation endpoint, a dedicated read-only monitor token that cannot POST Cron, stricter current/future/column ACL and 19-trigger checks, and a persistent alert outbox with retry, escalation, manual acknowledgement and recovery events. [Alert delivery implementation](RR-003-ALERT-DELIVERY.md) · [runtime role profile](RR-004-RUNTIME-ROLE.md). A one-off email drill was sent through connected Gmail and the owner explicitly confirmed receipt/reading; **automatic hosted email monitoring is still pending**. The owner has now approved **RPO ≤15m and service RTO ≤60m** as targets, with service compliance still unverified.

[The isolated role + protected feature-preview package](RR-004-ISOLATED-PREVIEW-PLAN.md) was subsequently separately approved and executed. [Actual managed runtime evidence](RR-004-MANAGED-RUNTIME-EVIDENCE.md): fresh limited login, 58 unchanged digests, eight zero audits, four feature-only secrets, protected preview `dpl_EqHn5GRrhCK3HfvcSojhkAnYhgJq` at SHA `3739fc6…`, live runtime GET 200 with matching fingerprints and auth denial 401. All 16 existing env entries and SSO remain unchanged. Status correctly returns 503 / `NO_COMPLETED_CRON_RUN`; no Cron replay was authorized. No original credential export, push, staging/production deployment or activation occurred. [Standalone Free email provisioning](RR-003-MAIL-PROVISIONING-PLAN.md) was separately approved; terms are accepted and the installation is verified Free/0.00 with zero connected projects. Resource creation stopped at required sender-domain metadata. The owner then confirmed Gmail-only availability and deferred email entirely. No Resend key was retrieved/injected; automatic delivery/scheduling are unverified.

### Initial takeover observations (historical; superseded above)

[Local source-bound evidence](RR-2026-11-09-LOCAL-EVIDENCE.md) · [RR-004 findings and acceptance](RR-004-SECURITY-FINANCIAL-AUDIT.md) · [RR-005 decision/approval package](RR-005-RELEASE-DECISION.md).

The current candidate adds forward-only **024_legacy_audit_immutability.sql**, tested on disposable PG17 only. **No Neon migration was performed**; live read-only isolated child inspection still reports 23 versions. RR-001's historical 011–023 SCHEMA PASS is preserved but does not certify 024 or current source/schema parity. Its preflight now reports source migrations pending rather than expanding authorization.

Agent fixes cover PgBouncer-safe Cron transaction locking, six legacy audit tables, complete precision-preserving restore data/schema checks, bounded/allowlisted monitor output, overdue push detection and missing integration workflow paths. Historical audit fixture UPDATEs were replaced with initial INSERTs on fresh synthetic groups. No ledger/CASH/NONCASH state or engine activation rule was changed to make tests pass.

Read-only provider recheck: PostgreSQL 17, Free `free_v3`, history 21600s, zero snapshots, empty source schedule; production/default and development branch topology unchanged. Connector role owns 51 public tables and can CREATE in public; deployed runtime authority remains unverified. Available `create_snapshot` accepts a historical timestamp/LSN, so a separately approved historical-snapshot → new-branch restore is a concrete next route; tool availability is not evidence the Free plan supports execution. No provider resource was created, deleted or restored.

Physical RR-002 remains owner-deferred, not PASS. RR-003 managed recovery/external monitoring, RR-004 accountable human signoff/runtime-role boundaries, and RR-005 exact-source staging/production approval remain release blockers. PR #16 Draft, engine literal OFF, **NO-GO**. Production dependency scan is non-clean (one moderate and one low tooling advisory); see RR-004 for evidence and unresolved disposition.
