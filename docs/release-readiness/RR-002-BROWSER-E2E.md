# RR-002 — Browser, mobile emulation and physical-device release gate

**Feature branch:** `feat/settlement-cycles-bilateral` · **Draft PR #16** → `develop`  
**Date:** 2026-11-05  
**Current status:** **TEST INFRASTRUCTURE IMPLEMENTED — E2E GATE NOT GREEN / NO-GO.**  
**Financial engine:** `SETTLEMENT_CYCLE_ENGINE_READY=false`. No changes to financial release flags, shared Neon schemas or original cash/noncash ledgers.

## Implementation

- `tests/rr002-browser.e2e.mjs`: uses **actual Playwright browser engines**, the built Next.js production server, signed Better Auth sessions and **disposable PostgreSQL 17**. It does **not** mistake JSX/static contract inspections for user-interaction E2E.
- `.github/workflows/rr002-browser-e2e.yml`: dedicated, PR-triggered/dispatchable PostgreSQL 17 workflow, versioned SQL migrations, Next.js build, separately installed pinned Playwright `1.64.1`, Chromium and WebKit, 4 browser profiles, optional synthetic-only screenshot artifacts. Does **not** deploy or touch shared Neon.
- `tests/rr002-safety.test.mjs`: unit-level fail-closed checks (exact localhost DB, explicit CI gate, no financial test-write flags, source touch target).
- `components/groups/settlement-cycle-source-list.tsx`: source invoice link minimum height increased to 44 CSS px (`min-h-11`).

The browser runner refuses execution unless `CI=true`, `RR002_TEST_ONLY=isolated-pg17`, `DATABASE_URL=postgresql://test:test@localhost:5432/group_expense` and `BETTER_AUTH_URL=http://localhost:3112`. It rejects BN004/BN006/SC005/SC009/SC007 financial test-write flags. All synthetic original invoices used to exercise pagination are inserted only in that disposable CI database. User identity is derived from genuine Better Auth browser cookies, not a fake authorization header.

## Automated browser profiles (code complete, execution pending)

| Profile | Engine / viewport | Evidence status |
|---|---|---|
| Desktop Chromium | Chromium, 1440 × 900 | Not yet passed full browser flow |
| Desktop WebKit | WebKit, 1440 × 900 | Not yet passed full browser flow |
| iPhone emulation | WebKit + Playwright iPhone 13 device descriptor | Not yet passed full browser flow; **not physical iOS Safari** |
| Android emulation | Chromium + Playwright Pixel 7 device descriptor | Not yet passed full browser flow; **not physical Android Chrome** |

## RR-002 interaction and security matrix (implemented assertions)

| ID | Test intent | Intended expected result |
|---|---|---|
| RR2-01 | Anonymous deep-link /groups and private cycle path | Redirect/sign-in; no private group data |
| RR2-02 | Real Better Auth signup and four concurrent role identities | Per-browser session cookie; rate limits remain enabled |
| RR2-03 | Owner opts into cycles + bilateral option, unrelated admin visits management | Owner views choices; unrelated admin cannot grant cycle rights |
| RR2-04 | Authenticated owner reviews a past *synthetic* manual cycle | Review preview rendered; locking blocked until explicit checkbox |
| RR2-05 | Preview becomes stale after another original bill is created | Server returns 409; preview and consent are cleared, no lock |
| RR2-06 | Reload current preview and lock after independent acknowledgment | Immutable LOCKED snapshot, no payment confirmation |
| RR2-07 | 55 synthetic original obligations, 50-row source pagination | Page 1/page 2 show identical canonical aggregate, original links preserved |
| RR2-08 | Bilateral member dropdown and original-source disclosure by keyboard | Exactly one counterpart selected; disclosure controls ARIA; original FIFO details visible |
| RR2-09 | Financial engine compile-time OFF | Proposal/apply/repayment buttons disabled; no ledger or CASH records created |
| RR2-10 | Active group admin and outsider try another pair's private data | Admin denied pair API (403); outsider cannot view cycle or private source |
| RR2-11 | Actual owner/counterparty open, respond and resolve an original-source dispute | Consent mandatory; private reason/audit only to pair; no money mutation |
| RR2-12 | Temporary network failure during reconciliation | Inline alert/retry; browser remains signed in |
| RR2-13 | Reload signed-in cycle | Remains authenticated; no login flash |
| RR2-14 | Mobile layout, button touch size, horizontal overflow | No horizontal overflow; key selectors and links ≥44 CSS px |
| RR2-15 | Installed PWA manifest available and screenshots | Manifest status 200; synthetic screenshot captures on phone emulation |

**Important:** This matrix describes coded assertions, not all PASS results. Physical devices, installed iOS PWA storage, accessibility screen readers/real touch, and separate visual-regression baseline signoff have **not** been performed.

## GitHub verification history and current blocker

- Original new workflow before the test file existed failed with `Could not find tests/rr002-browser.e2e.mjs`. This was a setup sequencing problem and is resolved in the current tree.
- A browser run reached the test executor but stopped in the fixture with a JavaScript temporal-dead-zone variable collision; fixed by renaming the dispute button locator.
- A subsequent run [#42070632696](https://github.com/mnhtng/group-expense/actions/runs/42070632696) successfully installed browsers and built Next.js, but the first 4-profile setup stopped because **Better Auth signup returned HTTP 429** when creating many synthetic accounts from one local IP. This is expected authentication protection, not evidence of a financial bug.
- The current test harness respects real Better Auth rate limiting by bounded retry after `X-Retry-After`/`Retry-After`; does **not** turn off or spoof authentication defenses. Commit: `7d556985607e5ae8cac4fb28257ae7af2b4adb7b`.
- On that SHA, all GitHub workflows ([CI #42071610473](https://github.com/mnhtng/group-expense/actions/runs/42071610473), [Integration #42071610481](https://github.com/mnhtng/group-expense/actions/runs/42071610481), [Browser #42071610402](https://github.com/mnhtng/group-expense/actions/runs/42071610402)) failed **before a GitHub runner was assigned**, with `runner_id=0`, empty `steps` and no normal job logs. A manual retry of the browser job also failed without a runner. Thus the latest revision has **no actual Playwright execution result**, not a test assertion failure.
- Previous commit `31046c718b9fbce9a018644dfe35cb12ffb5b344` had [CI SUCCESS #42070632715](https://github.com/mnhtng/group-expense/actions/runs/42070632715) and [PG17 Integration SUCCESS #42070634602](https://github.com/mnhtng/group-expense/actions/runs/42070634602). Those prove base regressions, **not** browser E2E.
- The runner allocation issue may be quota, billing, Actions permission or availability; GitHub Actions UI/job annotations must be inspected by a repository administrator to determine the exact cause. No particular explanation is confirmed by connector evidence.

### Required to complete RR-002

1. Inspect [RR-002 failed browser run](https://github.com/mnhtng/group-expense/actions/runs/42071610402) and its job annotations; restore GitHub-hosted runner allocation if needed.
2. Re-run the browser workflow at the exact reviewed commit. Require **all four profiles PASS** with human-readable evidence and archive a small synthetic-only screenshot artifact; fix any further application or test assertion failures discovered.
3. Perform independent tests on physical iPhone/iOS installed PWA and Android installed PWA, including safe-area, long-lived cookie behavior, touch/focus keyboard, offline->online recovery, screen reader and actual device screenshots.
4. Preserve `SETTLEMENT_CYCLE_ENGINE_READY=false`, Draft PR #16, no shared Neon migration and no financial transaction. Do not mark RR-002 fully accepted or release GO until the above pass.

## References

- [Release Readiness backlog](./BACKLOG.md)
- [SC-008 member-facing UI contracts](../settlement-cycles/SC-008-MOBILE-UI.md)
- [SC-009 disputes/privacy](../settlement-cycles/SC-009-NOTIFICATIONS-DISPUTES-RECONCILIATION.md)
- [SC-010 operational NO-GO](../settlement-cycles/SC-010-OPERATIONS-ROLLOUT.md)
