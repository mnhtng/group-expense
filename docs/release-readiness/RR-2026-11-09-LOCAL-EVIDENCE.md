# Release-readiness local execution evidence — 2026-11-09

**Verdict: verified local technical progress; release NO-GO.** Read with [RR-004 findings](RR-004-SECURITY-FINANCIAL-AUDIT.md), [RR-003 managed drill](RR-003-RECOVERY-DRILL.md) and [RR-005 decision](RR-005-RELEASE-DECISION.md).

## Source identity and provenance

- Starting and still-current Git HEAD: `41bc3ae39e90d103242f05372902be457aa88209`, branch `feat/settlement-cycles-bilateral`. Starting working tree was clean; delivered changes are **uncommitted**. No push, merge or hosted Actions run was performed.
- **Final complete verification** used code digest **`5062055aa2455e9f1820f7bf4a13dd91b7b33f2f6c0a8560bd5c690df1dbe11b`** across 255 source/config files, **Node 22.23.4**, and a fresh PG17 container. Unit, production build, migration/idempotency, all integration tests, HTTP, all four browsers, financial audits and logical restore passed sequentially at this final source state. The source manifest explicitly reports `trackedTreeClean:false`; this is working-tree evidence, not clean-commit or independent attestation.
- Earlier Node 24 rounds also passed. After a public-table inventory guard was added to the restore verifier and Vercel metadata confirmed runtime 22.x, the complete final round above was executed again on Node 22. This supersedes the earlier round at `d94addd1f94e60bdf88c4bf96d3d67bb36bec70b90687a7c3e3c29239d789f1b`. Do not attribute these uncommitted changes to the clean Git HEAD alone.
- `node scripts/rr005-source-evidence.mjs` records the current commit, dirty/untracked code state, code digest and every migration checksum without reading secrets or connecting to a service. Markdown documentation is excluded from the code digest. It always reports NO-GO and no independent approval.
- Local evidence/log copies are under ignored `rr003-artifacts/2026-11-09/` with restricted permissions. They are local, mutable evidence; no external attestation or public financial dataset is claimed.

## Environment and execution

macOS ARM64, final Node **22.23.4** (earlier supplementary runs: 24.15.0), Next.js **16.4.3**, TypeScript **5.9.3**, Docker/Colima PostgreSQL **17.11**, exact disposable URL `postgresql://test:test@localhost:5432/group_expense`. The task created its own loopback-bound container; no pre-existing database was adopted. A fresh container was used for the final full round. Playwright **1.64.1** was installed under `/tmp`, matching the repository runner; application dependencies/lockfile were not changed.

The first attempt with the preinstalled Playwright 1.62.1 failed before browser interaction because its expected executable was absent. This environment failure was resolved by using the project's pinned version; the later four-profile result below is actual execution. The initial plain `pnpm test:unit` shim attempted package-manager fetching and failed; tests were run with the exact Node command from `package.json`. Dependency auditing later used `--config.manage-package-manager-versions=false` without modifying the project.

| Check | Actual result | Scope / limits |
|---|---|---|
| Unit, `node --experimental-strip-types --test tests/*.test.mjs` | **163 PASS, 0 fail/skip** | Includes recovery target guards, precise comparisons, monitor response limits/allowlist, clocks/backlog, hard-OFF and existing financial properties |
| Migrations, `node db/migrate.mjs` twice | **001–024 applied, second run verified** | Fresh disposable PG17 only; no historical migration edited, no Neon migration |
| Integration, `node --test tests/*.integration.mjs` | **10 PASS, 0 fail/skip** | Real SQL constraints/auth, 16 two-session cash-allocation races, six legacy audit tables × UPDATE/DELETE/TRUNCATE denial, full table coverage and precise hashes |
| Final restore-verifier additions | **Focused PG17 regression PASS** | A one-microsecond source difference and disabled audit trigger are detected; extra public table fails closed; tests use their own new disposable database |
| Production build / TypeScript route generation | **PASS** | Final working tree; no deployment |
| ESLint | **0 errors, 2 pre-existing warnings** | Unused `assert` in SC-007 auditor and `resolve` in browser test; warnings were not suppressed |
| HTTP, `node --test tests/*.smoke.mjs` | **1 parent PASS, 0 fail/skip** | Existing complete signed Better Auth → APIs → PG17 story plus new operational regressions; one Node test contains many assertions |
| Browser, `node --test tests/rr002-browser.e2e.mjs` | **4/4 profiles PASS; 5/5 Node tests** | Chromium desktop, WebKit desktop, iPhone WebKit emulation, Pixel/Android Chromium emulation; physical devices and installed PWA NOT tested |
| Independent financial SQL, `node db/sc007-audit.mjs` | **8/8 checks, 0 violations** | Before HTTP, after HTTP, after browsers; synthetic original obligations, CASH/pending, NONCASH, source links and live balances |
| PG17 `pg_dump` → new database → `pg_restore` | **15/15 selected-source + 58/58 full data/schema matches** | Local logical restore only; repeated final read-only comparison after inventory guard also PASS |
| Production dependency advisory scan | **NON-CLEAN: 1 moderate, 1 low; no high/critical** | 328 locked production dependencies; scan exit 1 retained. See RR-004 for unresolved `shadcn` toolchain advisories and reachability limits |
| `git diff --check` | **PASS** | No whitespace errors in final diff |

The full-round HTTP test now verifies:

- Missing/wrong Bearer and invalid replay reason denial; signed replay uses the same pipeline.
- A recurring-table lock blocks an actual worker while an independent session observes its **open lock transaction** and **committed running audit**. An overlapping worker gets 202 and does not create another run; locks are absent afterward.
- Temporary table-name fault in this synthetic database produces an actual recurring SQL-stage failure, terminal failed audit, HTTP 503 and Retry-After. The table is restored in `finally`; no source rows are rewritten.
- 201 newly inserted future-only recurring templates produce an incomplete 200-rule scan and HTTP 503 partial without generating original invoices. Only those new templates are removed; authorized recovery replay then returns 200.
- A synthetic interrupted run yields status 503 and `STUCK_CRON_RUN`; the real local status endpoint feeds the monitor parser for 503 and wrong-token 401. This uses an explicit local HTTP transport adapter, **not external HTTPS/TLS or alert delivery**.

The restored synthetic data included **925 obligations**, **41 CASH records**, **1 applied NONCASH document**, **896 frozen sources**, **1 late attribution**, **5 dispute documents**, **10 dispute events** and **7 operational runs**. These counts describe disposable fixtures only. Restore checks include every public table (including original item-level provenance, signatures, snapshots, auth/notification state) plus columns, constraints, enabled trigger definitions, functions, views and indexes. No dump or raw row content is committed; the dump is removed by the restore script. Role/ACL/RLS/provider-policy equivalence and external side effects are outside these 58 checks.

## Provider and review boundary

Read-only connected Neon inspection on 2026-11-09 confirmed project `withered-salad-00928018`, PostgreSQL 17, Free `free_v3`, history retention **21600 seconds**, three existing branches, zero snapshots and empty snapshot schedule on source `br-curly-rice-b3xenws6`. That source still has **23** migrations; connector role is not superuser but owns 51 public tables and can CREATE in public. This is **not** proof about the deployed runtime role. No secrets, financial row contents or identity-bearing records were exported.

The available provider `create_snapshot` accepts historical timestamp/LSN; actual support/execution under this plan remains unverified. No provider branch/snapshot was created, deleted, restored, swapped, promoted or schema-migrated. No RPO/RTO or external alert acknowledgement is claimed.

GitHub recheck after local verification: [PR #16](https://github.com/mnhtng/group-expense/pull/16) is **open Draft**, base `develop`, remote head `41bc3ae39e90d103242f05372902be457aa88209`, unmerged. Submitted reviews listing was empty. No independent finance/security approval exists in this evidence.

**Still required:** managed restore and representative managed finance conservation, approved/measured recovery targets, real external monitor delivery/acknowledgement, runtime least privilege, disposition of dependency advisories, physical-device/PWA risk decision, independent reviewers and separate staging/production approval. `SETTLEMENT_CYCLE_ENGINE_READY=false` throughout.

## Read-only Vercel deployment metadata — 2026-11-09

Connected project `group-expense` (`prj_pBD9UtMAhNGFWh7Qmzskq90lVSC7`) reports Next.js with **Node 22.x**. Latest automatic feature preview `dpl_DFXJ2BY8UBQRNSUYUyedoECjGfdw` is READY, target null, `sin1`, source `41bc3ae39e90d103242f05372902be457aa88209`. The listed READY production deployment `dpl_6vc1vcdtSJr2AUMVGRNzRPdWHkM4` is from **main** at `b0c7e0ec6af450975e4e5d2f2752a150953130fa`. Neither contains the current uncommitted candidate. READY describes provider build metadata, not a successful protected HTTP/finance/restore acceptance test.

Project metadata reports SSO deployment protection enabled for `all_except_custom_domains`. An external monitor of an isolated protected preview must have separately approved machine access in addition to the application's Cron Bearer secret. Do not disable protection or put bypass credentials in URLs/logs to make a probe pass. No deployment, alias, protection, environment value or secret was changed/exported; no remote HTTP probe or preview Cron replay was performed. Runtime DB identity, secret targets and actual production schema remain unverified. The provider's minimal metadata response does not attest all build/install/Cron configuration.

Final runtime alignment: the full suite was executed on Node **22.23.4**, matching the Vercel/CI **22.x** major. This is local verification on the final dirty source digest, not execution on the remote preview/production deployment. The provider production branch metadata also reports `protected:false`; no branch-protection policy change was authorized or performed. Its operational implications require owner/provider review alongside recovery policy.
