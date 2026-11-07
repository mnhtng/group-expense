# RR-002 — Browser, mobile emulation and physical-device release gate

**Feature branch:** `feat/settlement-cycles-bilateral` · **Draft PR #16** → `develop`  
**Date:** 2026-11-05  
**Current status:** **LOCAL AUTOMATED BROWSER E2E PASS (4/4 profiles on 2026-11-07)**; physical-device/installed-PWA acceptance and other release gates are **not complete — overall release NO-GO**.  
**Financial engine:** `SETTLEMENT_CYCLE_ENGINE_READY=false`. No changes to financial release flags, shared Neon schemas or original cash/noncash ledgers.

## Implementation

- `tests/rr002-browser.e2e.mjs`: uses **actual Playwright browser engines**, the built Next.js production server, signed Better Auth sessions and **disposable PostgreSQL 17**. It does **not** mistake JSX/static contract inspections for user-interaction E2E.
- `.github/workflows/rr002-browser-e2e.yml`: dedicated, PR-triggered/dispatchable PostgreSQL 17 workflow, versioned SQL migrations, Next.js build, separately installed pinned Playwright `1.64.1`, Chromium and WebKit, 4 browser profiles, optional synthetic-only screenshot artifacts. Does **not** deploy or touch shared Neon.
- `tests/rr002-safety.test.mjs`: unit-level fail-closed checks (exact localhost DB, explicit CI gate, no financial test-write flags, source touch target).
- `components/groups/settlement-cycle-source-list.tsx`: source invoice link minimum height increased to 44 CSS px (`min-h-11`).

The browser runner refuses execution unless `CI=true`, `RR002_TEST_ONLY=isolated-pg17`, `DATABASE_URL=postgresql://test:test@localhost:5432/group_expense` and `BETTER_AUTH_URL=http://localhost:3112`. It rejects BN004/BN006/SC005/SC009/SC007 financial test-write flags. All synthetic original invoices used to exercise pagination are inserted only in that disposable CI database. User identity is derived from genuine Better Auth browser cookies, not a fake authorization header.

## Automated browser profiles (local four-profile matrix PASS; hardware pending)

| Profile | Engine / viewport | Evidence status |
|---|---|---|
| Desktop Chromium | Chromium, 1440 × 900 | **PASS** — full local signed-browser flow, 2026-11-07 |
| Desktop WebKit | WebKit, 1440 × 900 | **PASS** — full local signed-browser flow, 2026-11-07 |
| iPhone emulation | WebKit + Playwright iPhone 13 device descriptor | **PASS** — local emulation only; **not physical iOS Safari** |
| Android emulation | Chromium + Playwright Pixel 7 device descriptor | **PASS** — local emulation only; **not physical Android Chrome** |

## Verified local automated browser matrix — 2026-11-07

The owner provided the terminal output from two consecutive local runs on the feature branch after the Service Worker test-harness correction. **These are observed local execution results, not a GitHub-hosted CI run or a physical-device test.**

1. `RR002_PROFILE=webkit-desktop bash scripts/rr002-local.sh`: WebKit desktop subtest **PASS**; test runner reported `tests 2 / pass 2 / fail 0` (parent + browser).
2. `bash scripts/rr002-local.sh` (no profile filter): **all 4 browser subtests PASS**: `chromium-desktop` (6433 ms), `webkit-desktop` (7143 ms), `iphone-simulator` (7385 ms) and `android-phone-simulator` (9147 ms). Runner reported **`tests 5 / pass 5 / fail 0`**, duration ~42.6s, with `RR-002 local browser E2E PASS`.
3. On the full run the script provisioned temporary loopback-only Docker PostgreSQL 17; applied migrations 001–023 and verified no changes on a second migration invocation; built Next.js 16.4.3 with successful compilation, TypeScript, and generated pages. All browser profiles executed the genuine signed-in consent, stale fingerprint HTTP 409, lock, 55 original-obligation pagination, privacy, pair dispute, offline-alert/retry and no-financial-write invariants present in the browser scenario.
4. **Root-cause chain validated:** `pointerdown BUTTON → focusout checkbox → nav reappears → pointerup NAV → click not on button` was captured on the original app; common CSS fixed; Chromium/Android then passed, and the remaining WebKit offline test passed after an isolated signed context with `serviceWorkers:"block"` and explicit interception counts.
5. **Exact commit attribution:** The shared terminal log does **not include** `git rev-parse HEAD`. The GitHub feature head immediately before this evidence-only documentation update was `aa1eba35f6b4bf700e31cee07be39b07f45b319b`; do **not** claim the Mac HEAD was independently verified as that SHA. Before final release signoff, collect `git rev-parse HEAD` for an identical tested source revision and rerun anything changed in app/test logic.

**What this closes:** the **local automated cross-browser E2E portion** of RR-002 is green. **What this does not close:** physical iOS Safari/installed PWA, real Android Chrome/installed PWA, representative keyboard/real-touch and offline behavior, independent accessibility review, hosted CI on the reviewed commit, and RR-003/004/005. The broader RR-002 device/release gate remains **PENDING**, and the finance feature remains hard OFF. The `139/139` unit result was from an earlier local SHA; don't claim the full unit/HTTP/integration matrix has been rerun on the evidence-only documentation commit.

## Local four-profile run after click root-cause remediation — 2026-11-07

The user's `bash scripts/rr002-local.sh` command ran against a **disposable PostgreSQL 17** instance, migrations 001–023 (second verification idempotent), and an optimized Next.js 16.4.3 build. All completed successfully.

**Browser results: 2 / 4 profile subtests passed**:

- `chromium-desktop`: **PASS** end-to-end, including stale snapshot 409, final lock, original 55-source pagination, pair privacy, dispute lifecycle, injected network failure/retry and no financial mutation.
- `android-phone-simulator`: **PASS** equivalent emulated-browser flow.
- `webkit-desktop`: failed only at the final controlled network-failure case: 30-second timeout waiting for a `region["Đối soát và trao đổi"]` error alert after `page.route("**/settlement-cycle/cycles/*/reconciliation", route => route.abort("failed"))` and page reload.
- `iphone-simulator`: identical WebKit-family failure at the exact same network-failure assertion. Upstream WebKit UI interactions and dispute cycle reached this final step, but a passing full profile cannot yet be claimed.

**Investigation:** The RR-002 signed scenario was created with `serviceWorkers:"allow"`. Group Expense explicitly registers `/sw.js` on authenticated pages. Playwright's official `page.route` documentation warns that page-level routes do **not** intercept requests handled by Service Workers and recommends `serviceWorkers:"block"` when reliably mocking network requests. This is a plausible cross-WebKit explanation for the injected request not failing; the earlier log did not count route invocations, so the actual intercept failure is **not yet proven**.

**Targeted harness correction (no product API or money-logic change):** The network-failure case now runs in a separate fresh `browser.newContext({..., serviceWorkers:"block", storageState:await owner.context.storageState()})`. It still uses a legitimate server-issued Better Auth session and actual Playwright `route.abort("failed")`. It verifies `requested>0` and `intercepted>0` before treating the inline alert as success, then unregisters interception, clicks the real retry button and waits for the reconciliation report. It closes the fault context, while the primary signed browser context continues running with Service Workers **allowed** and still verifies session persistence, source balances and zero finance side-effects. If the alert still does not appear, a scoped diagnostic includes request/intercept counters and region/retry presence, rather than masking the fault.

**Next verification required:** first run `RR002_PROFILE=webkit-desktop bash scripts/rr002-local.sh`, then the default full four-profile matrix once WebKit passes. Do **not** mark RR-002 PASS solely from the code change or synthetic desktop Safari tests; physical-device/PWA, PITR, finance signoff and rollout gates remain outstanding.

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
- The browser harness now creates exactly **four** real Better Auth identities one time at suite bootstrap, captures server-issued Playwright `storageState` cookies, and reuses these signed identities in fresh independent contexts on all four browser profiles. Thus it does not generate 16 rapid signups from one CI IP. The initial provisioning still respects real HTTP 429 via bounded `X-Retry-After`/`Retry-After`; no auth policy bypass is enabled. Synthetic-only screenshot evidence is also recorded when an E2E assertion fails. Implemented after the initial HTTP 429 run; not yet successfully exercised on GitHub-hosted runners.
- On that SHA, all GitHub workflows ([CI #42071610473](https://github.com/mnhtng/group-expense/actions/runs/42071610473), [Integration #42071610481](https://github.com/mnhtng/group-expense/actions/runs/42071610481), [Browser #42071610402](https://github.com/mnhtng/group-expense/actions/runs/42071610402)) failed **before a GitHub runner was assigned**, with `runner_id=0`, empty `steps` and no normal job logs. A manual retry of the browser job also failed without a runner. Thus the latest revision has **no actual Playwright execution result**, not a test assertion failure.
- Previous commit `31046c718b9fbce9a018644dfe35cb12ffb5b344` had [CI SUCCESS #42070632715](https://github.com/mnhtng/group-expense/actions/runs/42070632715) and [PG17 Integration SUCCESS #42070634602](https://github.com/mnhtng/group-expense/actions/runs/42070634602). Those prove base regressions, **not** browser E2E.
- The runner allocation issue may be quota, billing, Actions permission or availability; GitHub Actions UI/job annotations must be inspected by a repository administrator to determine the exact cause. No particular explanation is confirmed by connector evidence.

### Subsequent diagnosis (2026-11-06)

- Current reference commit before this evidence update: `c157f6b527210e8f118a92b589b2d4f51b98009b`.
- Three independent GitHub-hosted job families again failed in ~3 seconds, with **`runner_id=0` and `steps=[]`**: [RR-002 Browser #42074263912](https://github.com/mnhtng/group-expense/actions/runs/42074263912), [CI #42074264036](https://github.com/mnhtng/group-expense/actions/runs/42074264036), [PG17 Integration #42074263874](https://github.com/mnhtng/group-expense/actions/runs/42074263874). It is **not** a failed browser assertion on those commits; the runner never starts.
- No access to the personal GitHub account's billing status or detailed job annotations is available via the connected GitHub repository tools. **Billing hold, exhausted Actions budget or failed payment are plausible, but not proven.** GitHub's official [workflow troubleshooting guide](https://docs.github.com/en/actions/how-tos/troubleshoot-workflows) recommends checking Actions billing and budgets. Its [locked account guide](https://docs.github.com/en/billing/how-tos/troubleshooting/locked-account) notes that even a failed payment authorization can block free-tier Actions.
- Account owner action: open [Actions failing job](https://github.com/mnhtng/group-expense/actions/runs/42074263912) and read the job's red annotation; review [Billing & Licensing](https://github.com/settings/billing) → **Budgets and alerts** (Actions monthly product/SKU budgets and stop-usage thresholds) and payment-method status. Changing payment settings or budgets may cost money and is **not** performed by this release-readiness task. If the account is correctly funded and the restriction persists, contact [GitHub Support](https://support.github.com) with those three job links and `runner_id=0` evidence.
- A trial run of the RR-002 browser job was already retried once without runner allocation; repeated code commits do not resolve an account-level runner block.
- **No claim of CI green at current commit.** Last genuine baseline CI and PG17 PASS are the earlier runs documented above. The E2E green/physical-device release gate remains unfulfilled.

### Low-cost execution policy (2026-11-06)

The project owner's GitHub Actions usage limit has been reached; **do not repeatedly retry GitHub-hosted runners**. RR-002 browser runs are now opt-in, with `pull_request: types: [labeled]` plus a job guard that permits only the **`run-rr002-e2e`** label. Pushing commits to this Draft PR no longer launches the heavyweight RR-002 browser matrix. Remove and re-add that label to request another run when minutes are available. The `workflow_dispatch` event is also retained but requires the workflow to be present on the repository default branch to be available.

For an offline-from-GitHub-Actions runner on **macOS or Linux**, use the reviewable script `scripts/rr002-local.sh`, which fails closed if it sees production-looking connection settings or financial test-write flags. Requires local Docker, Node.js 22+, pnpm and npm:

```bash
git switch feat/settlement-cycles-bilateral
bash scripts/rr002-local.sh
```

- Launches **its own** disposable PostgreSQL 17 container, bound only to `127.0.0.1:5432`; refuses to hijack a port already in use.
- Forces signed Better Auth Next.js app to target only `postgresql://test:test@localhost:5432/group_expense`; never passes database credentials to GitHub.
- Reapplies the SQL migrator twice to verify idempotency, builds Next.js, installs Playwright separately in a throwaway directory and executes all four Chromium/WebKit/mobile-emulated browser profiles.
- Cleans up the temporary database container and Playwright tooling on normal exit **and failure**; leaves only synthetic failure screenshot artifacts in `rr002-artifacts/`. **Never point this script at Neon or a shared local PostgreSQL instance.**
- The script was syntax-checked as Bash; no claim that the full browser suite has passed on a developer's Mac/Linux machine.

**Defer without blocking ongoing development:** four-browser repeated runs per commit, expanded visual screenshot baselines, additional emulator permutations, real hardware PWA/screen-reader exploratory testing **until a release decision is actively being prepared**. Those controls are **not waived** for production acceptance. Before financial features are enabled, require signed cross-browser interaction on at least Chromium and WebKit, high-risk pair/privacy/consent/cash invariants, device acceptance representative of supported platforms, independently verified restore and staged release gates.

**Do not disable** the foundational unit, TypeScript, and PostgreSQL financial integration/audit suites in `.github/workflows/ci.yml` and `.github/workflows/sprint1-integration.yml`. These workflows continue to protect code and must be run locally or when Actions quota returns; they have not been green on the final RR-002 commit. Avoid marking the Draft PR ready for merge while any required check is missing.

### First local macOS run — observed real browser results (2026-11-06)

The user executed `bash scripts/rr002-local.sh` on Apple Silicon against script-created temporary Docker PostgreSQL 17:

- `pnpm install --frozen-lockfile` **PASS**; SQL migrations `001..023` **PASS**; second migration run reported **SQL migrations verified**, without reapplying migrations.
- Next.js `16.4.3` production build compiled and completed TypeScript/page generation **PASS**.
- Playwright `1.64.1` provisioned; actual Chromium desktop, WebKit desktop, iPhone WebKit emulation and Android Chromium emulation all **started and executed test interactions**.
- All four stopped at the **same initial assertion**: `409 must invalidate stale review preview`, test file line 271 in the earlier SHA; immediate DOM count was 1 rather than 0. This observation by itself **does not show** whether the snapshot POST returned 409 or whether the React state had finished committing; the original test waited for **any** alert and then counted immediately.
- Fix committed to the browser harness: await the **actual snapshot POST response**, assert `status() === 409`, await stale preview disappearance with a bounded auto-retrying Playwright `waitFor({state:"hidden"})`, require the **specific** stale-data error alert and cleared consent checkbox. The existing backend and UI 409 invalidation logic were **not changed** without evidence of a product defect.
- **Retest required:** run `bash scripts/rr002-local.sh` again at the updated SHA, inspect any first actual failed response/locator, and only then mark browser profiles PASS. The original test reported `tests 5, pass 0, fail 5` (four profile subtests plus their parent); no false green result is claimed.
- Safety unchanged: Docker PG17 ephemeral/loopback only, no shared Neon mutation, no financial ledger recording, engine hard OFF; PR #16 stays Draft.

### Second local macOS browser run — 2026-11-06

User report after the previous stale-preview synchronization adjustment:

- Docker PostgreSQL 17, all 23 migrations, second idempotent migration check, Next.js production build and TypeScript all **PASS** again.
- Chromium desktop: `page.waitForResponse` timed out (20 s) waiting for the snapshot lock POST response. It is **not proven** that the API responded incorrectly: the test recorded neither an outbound request nor the app handler state. The harness now waits on path + POST method and reports whether the browser actually dispatched a snapshot POST plus enabled/visible/consent UI state on timeout.
- WebKit desktop and iPhone 13 WebKit emulation: the native `<select id="cycle-pair-member">` yielded a **25px** hit target against the **≥44px** requirement despite its Tailwind `min-h-12` class. The application now explicitly sets **48px height and min-height**, with `h-12 min-h-12` utilities; this is a genuine observed UI/accessibility fix that still requires a confirming browser run.
- Android Chromium phone emulation: the test read `GET /disputes` and found no matching dispute after clicking Submit. The old `getByText(reason)` could observe text already present in the form rather than an asynchronously committed dispute; actual POST outcome was not recorded. The test now waits for the signed **POST /disputes** and requires **HTTP 201**, a returned dispute UUID/reason, rendered dispute article and confirmed GET visibility, with POST/201 barriers for both counterparty reply and reporter resolution. If it returns a different status, the next report will expose the real product-side failure instead of an ambiguous missing ID.
- The suite supports a **focused local replay** by setting `RR002_PROFILE` to exactly one of `chromium-desktop`, `webkit-desktop`, `iphone-simulator`, `android-phone-simulator`. Unset means the full four-profile suite. A focused PASS **does not certify** the RR-002 matrix.

Recommended efficient re-test (still disposable PostgreSQL, no Actions minutes):

```bash
git pull --ff-only origin feat/settlement-cycles-bilateral
RR002_PROFILE=chromium-desktop bash scripts/rr002-local.sh
# If Chromium is fixed, run the complete matrix without RR002_PROFILE:
bash scripts/rr002-local.sh
```

**Current status:** implementation and test corrections made; second-run 0/4 browser profiles passed, subsequent corrected run **not yet executed**. Do not mark RR-002 PASS, turn on the engine, migrate shared Neon, merge or deploy.

### Third local macOS Chromium-only run — 2026-11-06

The user's focused command `RR002_PROFILE=chromium-desktop bash scripts/rr002-local.sh` successfully provisioned the disposable Docker PG17, verified migrations 001–023 twice, and completed Next.js production build plus TypeScript. The focused Chromium suite was **RED** with:

```text
RR-002 snapshot POST not observed: dispatched=0,
buttonVisible=true, previewVisible=true, consent=true
page.waitForResponse: Timeout 10000ms exceeded
```

This rules out an observed HTTP 409/500 as the immediate failure: **the browser sent no observable snapshot POST**. A checked consent element and visible button alone do not prove the React handler executed or that its synchronous code succeeded. The root cause is **not yet confirmed** from this log alone.

The original lock UI called `crypto.randomUUID()` **before its `try/catch`**. This path could cause an unhandled synchronous exception, a silently stuck UI, and zero POSTs in a browser that lacks secure-context WebCrypto; the call now executes *inside* the error handling. The E2E now records: the native DOM click count (separating browser event delivery from handler effects), `window.isSecureContext`, whether `crypto.randomUUID` is a function, the lock button's current label, current alert(s), and page `pageerror` names/messages. No session cookies, request tokens or real financial data are recorded. **This is a test diagnostics and error-handling improvement, not a claim that Chromium now passes.**

An earlier static RR-002 guard still searched for `waitForResponse(response=>`, even after the real observer was refactored to use `waitForResponse(r=>`—updated the assertion to accept both; otherwise the next `pnpm test:unit` would fail unrelated to browser behavior.

Next local steps (after updating code):
```bash
git pull --ff-only origin feat/settlement-cycles-bilateral
pnpm test:unit
RR002_PROFILE=chromium-desktop bash scripts/rr002-local.sh
```
If still RED, use the **new error details** to investigate, rather than bypassing the UI with a direct API client or adding arbitrary click retries. Do **not** run GitHub Actions while the quota is exhausted. Engine hard OFF, PR #16 Draft, all shared Neon and money writes unchanged.

### Fourth local Chromium-only attempt — click actionability isolated (2026-11-06)

The user reran `RR002_PROFILE=chromium-desktop bash scripts/rr002-local.sh`. Disposable PostgreSQL 17, migrations 001–023 twice, Next.js compilation and TypeScript all **PASS**. The focused browser test still failed **before a snapshot POST**, with `dispatched=0`, `nativeClicks=0`, `secureContext=true`, `crypto.randomUUID=function`, consent checkbox checked, lock button visible, no page JS exceptions. This makes a WebCrypto failure unlikely and shows the earlier hypothesis was insufficient.

**Instrumentation flaw found:** `observeBrowserPost` used `Promise.all([page.waitForResponse(...,{timeout:10000}), lock.click()])`. `Promise.all` rejects at the shorter network timeout even while Playwright's actionability-based `lock.click()` is *still pending* under its longer default timeout. Consequently `nativeClicks=0` at that moment did **not** prove the browser dispatched a click, and the diagnostic masked Playwright's reason for waiting (overlay, movement, unstable control, etc.). Never use `force:true`, programmatic DOM click or a direct POST to bypass this gate.

The harness now **arms a response listener before the click**, **awaits the real `lock.click({timeout:8000})` first**, and only *after click resolves* waits up to 10 seconds for an observed HTTP response. It always removes its listener. A failed click now surfaces Playwright's actionability/call-log evidence (up to 1400 characters) rather than an irrelevant 10-second network timeout. All signed actual-browser POSTs in RR-002 use this revised helper; the default four-profile matrix and PostgreSQL guard remain unchanged. Its safety test has been updated to assert the new observer contract.

**Status: not yet rerun after this correction, E2E NOT PASS, release NO-GO.** For one focused diagnostic test without GitHub Actions:

```bash
git pull --ff-only origin feat/settlement-cycles-bilateral
pnpm test:unit
RR002_PROFILE=chromium-desktop bash scripts/rr002-local.sh
```

The next Chromium failure, if any, should report the true Playwright actionability error or a post-click request/HTTP failure. Do not loosen the 409 privacy/financial safeguards.

### Fifth local macOS run — root cause conclusively verified (2026-11-07)

The user ran `RR002_PROFILE=chromium-desktop bash scripts/rr002-local.sh` with the new real-application `pointerProbe`. Docker PostgreSQL 17, migrations 001–023 twice, Next.js 16.4.3 production compilation and TypeScript succeeded; Chromium stopped because the lock click never reached React.

**The exact recorded real DOM chain proves the UI bug:**

- Native `pointerdown` on `lock-button` at **(550,812)**, with bottom nav `display:none`.
- `focusout` from the consent checkbox immediately makes the nav `display:block`.
- Nav is **z-index 40**, covers vertical region **811–900px**; lock button spans **790–834px**.
- `pointerup` and `mouseup` hit `bottom-nav`; the resulting `click` targets a `div` instead of the lock button.
- Therefore `nativeClicks=0`, `dispatched=0`, with no JavaScript page errors or WebCrypto problem. This is not an HTTP backend failure.

**Definitive scoped remediation committed:** removed *both* global focus-driven overlay rules in `app/globals.css`: (1) conditional `.app-bottom-nav` display, and (2) `.expense-save-footer` position shifts. No replacement text-focus rule is introduced, because it would recreate the same mid-gesture failure on mobile. Existing app-shell bottom padding and nav safe area continue to reserve space.

**Real browser regression now checks more than a resolved click:** the fixed nav stays stable when checkbox receives focus, and the lock gesture's DOM `pointerdown`, `pointerup`, `click` must all reach the actual lock button. The test retains the real stale HTTP 409, consent revocation, fresh lock and unchanged CASH/NONCASH records.

Independent Chromium/Playwright A/B at the exact viewport/control geometry returned **original CSS: 0 button clicks** and **corrected CSS: 1 button click** (no force click or synthetic event injection). **The corrected full GroupExpense browser flow has not yet been run on the developer's Mac.** Do not mark RR-002 PASS until that run, all 4 profiles, and mobile/device checks are complete.

```bash
git pull --ff-only origin feat/settlement-cycles-bilateral
pnpm test:unit
RR002_PROFILE=chromium-desktop bash scripts/rr002-local.sh
# Only after Chromium passes:
bash scripts/rr002-local.sh
```

See [the detailed RCA and acceptance checklist](./RR-002-ROOT-CAUSE-PLAN.md).

### RR-002 continuation — keyboard regression, source provenance and device protocol (2026-11-07)

The **previous Mac four-browser E2E run passed 4/4**, but its shell log omitted `git rev-parse HEAD`. Follow-up implementation on the same Draft feature branch:

- The successful fresh REVIEW lock now also exercises **keyboard-only Space on consent → Tab to lock button → Enter** on both desktop browser profiles, and requires an actual browser HTTP **200** response and a subsequently locked snapshot. Phone emulation retains a real pointer click and now independently requires the HTTP **200** result. Stale-fingerprint HTTP 409, two-person privacy and no-money-mutation assertions stay active.
- The local runner prints the exact **source SHA**, `clean-tracked` / `DIRTY-TRACKED` indicator, and single-profile versus full-matrix scope before starting Docker. After the real browser tests pass it writes `rr002-artifacts/rr002-local-result.json` with those values, a completion timestamp, disposable DB classification and `physicalDevicesTested:false`. A focused test reports `fullBrowserMatrix:false`. This is locally generated evidence, **not** a signed/independent CI attestation.
- Added [physical iOS / Android installed-PWA acceptance protocol](./RR-002-PHYSICAL-DEVICE-ACCEPTANCE.md), including approved isolated HTTPS requirement, hardware keyboard/touch, safe area, installability, persistent sessions, offline isolation, private pair permissions and real screen-reader testing. The local runner cannot be opened from a phone on `localhost`, and an ordinary LAN IP over HTTP does **not** prove secure-context/PWA functionality. Any reachable isolated test deployment requires **separate approval**; this ticket does not deploy one.

**Verification status of these new follow-up changes:** not yet executed on a developer's Mac after they were committed. The earlier four-profile PASS is retained as historical evidence, not automatically attributed to the new SHA. Run `pnpm test:unit` and `bash scripts/rr002-local.sh` locally; inspect the source-bound JSON only after successful completion. Physical-device signoff remains PENDING; no production finance release approval.

### Post-keyboard-extension Mac run — 2026-11-07: WebKit focus policy

The owner ran the expanded `bash scripts/rr002-local.sh` against clean tracked source SHA `a9330eda742bdc3993e2a34478301acb06666cd3`. Temporary Docker PostgreSQL 17, all 23 migrations and idempotency recheck, Next.js 16.4.3 production build and TypeScript **PASS**. The browser profile results were:

- Chromium desktop **PASS**.
- iPhone WebKit emulation **PASS**.
- Android Chromium phone emulation **PASS**.
- **WebKit desktop FAILED** solely at new keyboard-only focus assertion immediately after `checkbox.focus() → Space → Tab`: `document.activeElement` was not the lock button. The test stopped *before Enter and before a successful lock request*; no evidence of a snapshot API or finance defect. Overall Node reporter: `tests 5, pass 3, fail 2` (parent fails with child).

**Root cause corroboration:** macOS WebKit's native sequential focus policy may skip `<button>` on plain Tab when the host's **System Settings → Keyboard → Keyboard navigation** is disabled. Playwright's own [#41808](https://github.com/microsoft/playwright/issues/41808) documents this as intentional Safari-compatible behavior. WebKit/Safari includes controls using **Option+Tab** by default ([WebKit #199671](https://bugs.webkit.org/show_bug.cgi?id=199671)). This is **not** a need to modify app buttons or authorization semantics.

**Corrected E2E:** Keep plain Tab and verify the button is actually focused. Only for **macOS + WebKit desktop**, if native Tab skipped the button, refocus the consent checkbox and issue actual **Alt+Tab**, then verify the lock button is focused and press **Enter** to send the genuine signed HTTP POST 200. Neither `button.focus()`, `force:true`, click-as-fallback nor `tabIndex` is used. A fail path reports the active element tag/type/role without exposing private user values; on Linux WebKit and Chromium unexpected focus behavior still fails.

**Status:** These changes have been committed but **NOT rerun yet**. Historical 4/4 browser PASS on the earlier implementation remains valid evidence of its coverage, but not of this newer keyboard scenario. Next local run must prove both desktop keyboard paths and all four profiles at the exact source SHA. All physical-device/installed PWA, RR-003/004/005 and finance release gates remain pending.

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
