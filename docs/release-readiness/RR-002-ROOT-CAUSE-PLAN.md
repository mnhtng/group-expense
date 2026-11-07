# RR-002 — Root-cause analysis and one-pass remediation plan

**Date:** 2026-11-06  
**Branch:** `feat/settlement-cycles-bilateral` / PR #16 remains Draft  
**Status:** Root cause verified in the actual GroupExpense Chromium browser. Central CSS fix and live-browser assertions committed; full browser matrix, mobile keyboard usability and physical-device signoff still pending. **Release NO-GO**, financial engine hard OFF.

## 1. Observed facts — do not confuse build success with browser success

The owner's fourth macOS run at `909aff25bf224e78a5181f1f76a3f5765951eba7` showed:

- `pnpm test:unit`: **139/139 PASS**.
- A fresh **disposable loopback-bound Docker PostgreSQL 17**: SQL migrations **001–023 applied**, second invocation idempotent.
- Next.js 16.4.3 **production build and TypeScript PASS**.
- Focused desktop Chromium browser: `locator.click({timeout:8000})` **resolved**, but no snapshot POST within 10 s; `dispatched=0`, `nativeClicks=0`, `buttonVisible=true`, `previewVisible=true`, `consent=true`, `secureContext=true`, `crypto.randomUUID=function`, `pageErrors=[]`.
- These facts rule out a *detected HTTP 409/500* as the immediate blocker. A non-mutated preview is not proof that its backend lock implementation is broken: **the POST was not observed**.

The tester's earlier fixes to response waiting, WebCrypto error capture and React state checks did not fix the zero-click symptom. They must not be repeated or expanded without a causal reproduction.

## 2. Root cause: focus-driven fixed-tabbar overlay during a click

### Application source evidence

- `app/globals.css` contains:
  ```css
  @supports selector(:has(*)) {
    .app-shell:has(input:focus, textarea:focus, select:focus) .app-bottom-nav {
      display: none;
    }
  }
  ```
  This includes `input[type=checkbox]`, even though a checkbox does not open the software keyboard.
- `components/notifications/notification-nav.tsx` renders `.app-bottom-nav` as `fixed bottom-0 z-40`, above normal page content.
- `components/groups/settlement-snapshot-panel.tsx` renders a consent checkbox immediately before the "Xác nhận khóa bản đối soát" button.
- `tests/rr002-browser.e2e.mjs` performs `checkbox.check()` followed by `lock.click()`.

**Mechanism:** checkbox focus hides the fixed tab bar. Chromium mouse down on the nearby confirmation button moves focus away from the checkbox; the fixed tab bar instantly reappears, potentially under the cursor before mouse up. The mouse-up target becomes the tab bar instead of the confirmation button. The final `click` dispatches on the lowest common ancestor rather than the button; its React `onClick` never runs, so no POST occurs. Playwright actionability checked the target *before* the focus-driven layout change and may consider the click action complete.

### Independent Chromium + Playwright A/B reproduction (verified)

A standalone synthetic HTML page reproduced the app's **same CSS selector**, a fixed `z-index:40` tab bar, a checkbox and a nearby confirmation button at a viewport edge (1440 × 900). With standard Playwright `checkbox.check()` followed by `button.click()`:

| Configuration | `button.click()` | Native button click count |
|---|---|---|
| Original `input:focus` selector | Resolves | **0** |
| Exclude checkbox from tabbar hiding | Resolves | **1** |

In the original configuration, the browser's document capture event sequence was:

```text
pointerdown BUTTON (nav hidden)
mousedown   BUTTON (nav hidden)
focusin     BUTTON (nav visible)
pointerup   NAV    (nav visible)
mouseup     NAV    (nav visible)
click       MAIN   (common ancestor; button onClick NOT fired)
```

This is a **real Chrome browser behavioral reproduction**, not speculation about API timing. It closely matches the user's log. It is not yet an instrumented hit-test on the *actual GroupExpense page*: before final signoff, verify actual pointer targets/geometry in the product viewport. This distinction matters.

## A-stage executable diagnostic — 2026-11-07

Stage A is now instrumented in `tests/rr002-browser.e2e.mjs` **without a production CSS change**. It records a bounded sequence of real browser `pointerdown`, `mousedown`, `focusin`, `focusout`, `pointerup`, `mouseup` and `click` events. For each event it records only a classified element role (`lock-button`, `checkbox`, `bottom-nav`, `main`, `other-button`), viewport pointer coordinates, `document.elementFromPoint`, and computed nav/button rectangle, display, pointer-events and z-index. It starts **before** checkbox focus and detaches listeners after the attempted click. On failure, the synthetic-only `pointerProbe` output appears in the test error. It contains no user names, text contents, cookies, request data or financial amounts.

Run **once**, only locally on a disposable PostgreSQL 17:

```bash
git pull --ff-only origin feat/settlement-cycles-bilateral
pnpm test:unit
RR002_PROFILE=chromium-desktop bash scripts/rr002-local.sh 2>&1 | tee rr002-pointer-diagnosis.log
```

**Important:** the shell pipeline above requires `set -o pipefail` if the exit status is consumed by another program; otherwise the status returned is that of `tee` even if browser tests fail. The captured log stays local. The synthetic test creates no real financial ledger entries.

**Proof required before applying Stage B:** `pointerdown.target="lock-button"`, followed by focus transition showing nav visibility change and `pointerup.target="bottom-nav"`, with subsequent click not delivered to `lock-button`. If the actual target sequence differs, inspect the recorded `hit` and geometry and **revise the RCA**, rather than patching the CSS by assumption. Do not treat an ordinary `locator.click()` resolve as proof of button activation.

## 3. One-pass fix plan — no more unrelated hotfixes

### Stage A: confirm against the real application before committing behavior changes

In one focused synthetic local browser run, record only non-sensitive DOM diagnostics at the locked-review consent/confirmation boundary:

1. Control bounding boxes (`getBoundingClientRect()`), `window.scrollY`, viewport dimensions, click coordinates, and `document.elementFromPoint(x,y)`.
2. `focusin`, `focusout`, `pointerdown`, `pointerup`, `click`: target **tag / stable role / data-testid only**; no text body, cookies, request headers, payment amounts or member data.
3. Nav computed `display`, `visibility`, `pointerEvents`, `position` and `zIndex` at each event.
4. Verify `pointerdown BUTTON` then `pointerup NAV` and suppressed button click. If this pattern is not reproduced, **stop** and inspect the true receiving element; do not implement a focus CSS fix solely from the synthetic A/B.

The existing `RR002_PROFILE=chromium-desktop` and local disposable PG17 runner are enough; GitHub Actions is not needed.

### Stage A — CLOSED: actual-app proof (2026-11-07)

The user ran the real signed browser harness, including the non-mutating DOM pointer probe, on the actual built Next.js app and disposable PostgreSQL 17. The trace **exactly matches** the independent synthetic experiment:

```text
viewport: 1440 x 900
lock button: top 790, bottom 834
fixed nav: top 811, bottom 900, height 89, z-index 40

pointerdown -> lock-button  (x 550, y 812, nav display none)
mousedown   -> lock-button  (nav display none)
focusout    -> checkbox     (nav display block)
focusin     -> lock-button  (nav display block)
pointerup   -> bottom-nav   (x 550, y 812, nav display block)
mouseup     -> bottom-nav
click       -> div          (not lock-button)
nativeClicks=0; dispatched=0
```

**Conclusive product-specific cause:** the CSS rule `:has(input:focus, textarea:focus, select:focus)` hides a fixed `z-40` navigation bar on checkbox focus and shows it again synchronously when the user focuses the adjacent confirm button. The bar covers the pointer before `pointerup` and steals the click. No API error, JavaScript exception, WebCrypto fault or arbitrary wait is needed to explain the observed failure.

### Stage B — IMPLEMENTED: stable focus-independent bottom overlays

- In `app/globals.css`, **remove both** `:has(...:focus)` rules that abruptly toggle `.app-bottom-nav` visibility and `.expense-save-footer` positioning on *any* focus transition. The app already reserves bottom space with `.app-shell` padding and applies safe-area spacing to the nav.
- Intentionally **do not substitute another focus selector restricted to text input**: text-input-to-submit gestures can suffer the exact same pointerdown/focusout/pointerup race on phones. Keyboard-driven UI must derive from actual viewport/keyboard state, not immediate DOM focus changes. Defer any new VirtualViewport-based keyboard hiding until it has separate iOS/Android device evidence; always-visible fallback is safer than intercepting financial consent.
- In `tests/rr002-browser.e2e.mjs`, assert the nav is visible on consent focus, and that the real lock gesture delivers **pointerdown, pointerup and click** to the actual lock button, not nav. Preserve response 409, re-preview, lock and no-finance-ledger mutation checks.
- In `tests/rr002-safety.test.mjs`, add a static guard against either regressing to the focus-driven bottom-nav/expense-footer rules.
- Replayed the exact browser geometry (viewport 1440x900, checkbox y770, button y790–834, nav starts y811) on independent Chromium/Playwright A/B fixture after patch: **original CSS: click resolved, 0 native button clicks; corrected CSS: click resolved, 1 native button click, pointerdown/up/click all BUTTON**, with normal Playwright actionability and no force click.

**Important:** the synthetic A/B validates the *mechanism and patch class*, while the actual Next.js browser test **has not yet been rerun after the CSS change**. It must still pass before RR-002 turns green. This patch intentionally avoids changing the finance backend or snapshot API.

### Stage C: permanent regression coverage

- Add a small **actual Chromium interaction** for the focused checkbox → confirm sequence at viewport positions likely to intersect the nav. Verify DOM `click` target is the confirmation button, not `MAIN` or `NAV`; `POST /snapshot` is emitted.
- Assert the **stale fingerprint POST returns 409**, preview and consent clear, persisted cycle state remains `review`, and then a fresh explicit preview+consent can lock without mutating any money ledger.
- Exercise **keyboard navigation** (focus checkbox, Space, Tab, Enter), desktop pointer, and touch-style input; test text-entry and select → next-action transitions in forms where tab bar visibility changes.
- Treat `page.getByRole(...).click()` resolving as **insufficient success evidence**. Wait for the committed domain outcome (HTTP response and UI/database state) and fail with a scoped click-target diagnostic if absent.
- Keep test identities synthetic, private auth cookies out of logs and artifacts, finance test-write guards fail-closed.

### Stage D: investigate *other* browser failures as separate causes

- **WebKit / iPhone dropdown measured 25px:** the previous inline 48px intervention is not proof of the CSS root cause. Compare `getComputedStyle(select).minHeight/height`, bounding-box height, ancestor transforms, viewport scale and loaded styles. Retain a permanent **≥44 CSS-px touch-target E2E assertion** for Chromium and WebKit, not just static class inspection.
- **Android dispute absent from GET:** verify the real signed **POST /disputes** status, documented response shape and DB row before checking GET visibility. Keep pair-only privacy/authorization assertions. Never turn this into a timer/retry workaround without evidence.
- **Service Worker:** core finance browser assertions should distinguish frame and Service Worker requests if interceptors influence instrumentation. The separate PWA test must retain real worker behavior.

### Stage E: acceptance/stop criteria

1. On the **exact final commit**, `pnpm test:unit`, `pnpm typecheck`, `pnpm build` PASS; disposable PG17 migration twice, HTTP/integration and finance audits PASS.
2. Focused Chromium: click target correctly stays `BUTTON` through `pointerup`, stale `POST /snapshot` actually returns **409**, then the fresh confirmation locks; unchanged original balances; no CASH/NONCASH side effects.
3. Full RR-002 E2E matrix: **Chromium desktop, WebKit desktop, iPhone WebKit emulation, Android Chromium emulation PASS**, with no skipped financial/privacy assertions, 44px touch targets, original-source pagination and dispute privacy checks intact.
4. Repeat the formerly failing Chromium scenario at least **three times** against fresh disposable DB fixtures to catch layout-timing flakes; no arbitrary sleeps, forced clicks or silent exceptions.
5. Physical iPhone/Android installed PWA and RR-003/PITR, RR-004/independent review, RR-005/staging release remain separate production release gates. Do not mislabel browser-emulated success as physical-device signoff.
6. Preserve `SETTLEMENT_CYCLE_ENGINE_READY=false`, PR #16 **Open Draft**, no merge or staging/production/parent Neon migrations, and no real ledger writes. GitHub Actions quota exhausted: use local Docker PG17 only.

## Decision

**Root cause CONFIRMED by production-build GroupExpense pointer logs:** fixed navigation appears between lock-button pointerdown and pointerup, intercepts the release and prevents the React onClick/POST. The shared focus-dependent overlay behavior has been removed and browser pointer assertions have been added. This is a product-level UI fix, not a weakened Playwright test or financial shortcut.

**Pending before PASS:** `pnpm test:unit`, typecheck/build, disposable PG17 browser matrix at the new commit, repeated formerly broken Chromium flow, and independent iOS/Android real-device/installed-PWA keyboard testing. PR #16 remains Open Draft; engine OFF; no changes to shared Neon or original CASH/NONCASH ledger.

## Post-remediation verification — 2026-11-07

The owner-provided local test run closes the **automated cross-browser verification** item that was pending when this RCA was written:

- The WebKit-only local run passed (`tests=2, pass=2, fail=0`).
- The complete Playwright suite against a new disposable PostgreSQL 17 passed **all four browser profiles** (`tests=5, pass=5, fail=0`; Chromium desktop, WebKit desktop, iPhone WebKit emulation, Android Chromium emulation).
- Next.js build/TypeScript and migration 001–023 plus idempotent second check also passed.
- Finance mutation guard and pointerdown/pointerup/click regression are in the covered test path, not bypassed.
- WebKit's controlled network-failure scenario passed after the fault-injection harness used a separate signed context with Service Workers blocked **only for that fault-injection test**.

**Remaining outside browser-automation scope:** The local log did not print the Mac's exact Git SHA; capture it before reviewed-commit attestation. Three independent fresh-run Chromium repetitions, physical iPhone/Android installed PWA, keyboard/accessibility testing, independent CI/HTTP/integration on the final reviewed commit and RR-003/004/005 are still separate checks. **Overall financial release NO-GO; engine OFF and PR #16 Draft.**

