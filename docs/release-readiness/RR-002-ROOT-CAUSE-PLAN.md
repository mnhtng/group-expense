# RR-002 — Root-cause analysis and one-pass remediation plan

**Date:** 2026-11-06  
**Branch:** `feat/settlement-cycles-bilateral` / PR #16 remains Draft  
**Status:** Root-cause mechanism independently reproduced in Chromium; application-specific pointer hit-test confirmation and full E2E signoff still pending. **Release NO-GO**, financial engine hard OFF.

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

## 3. One-pass fix plan — no more unrelated hotfixes

### Stage A: confirm against the real application before committing behavior changes

In one focused synthetic local browser run, record only non-sensitive DOM diagnostics at the locked-review consent/confirmation boundary:

1. Control bounding boxes (`getBoundingClientRect()`), `window.scrollY`, viewport dimensions, click coordinates, and `document.elementFromPoint(x,y)`.
2. `focusin`, `focusout`, `pointerdown`, `pointerup`, `click`: target **tag / stable role / data-testid only**; no text body, cookies, request headers, payment amounts or member data.
3. Nav computed `display`, `visibility`, `pointerEvents`, `position` and `zIndex` at each event.
4. Verify `pointerdown BUTTON` then `pointerup NAV` and suppressed button click. If this pattern is not reproduced, **stop** and inspect the true receiving element; do not implement a focus CSS fix solely from the synthetic A/B.

The existing `RR002_PROFILE=chromium-desktop` and local disposable PG17 runner are enough; GitHub Actions is not needed.

### Stage B: fix the root UI interaction, not the assertion

Apply a focused change to **both** keyboard-conditional layout rules in `app/globals.css`:

1. Do **not** hide the tab bar on `checkbox`, `radio` or other controls that do not open a keyboard. Do **not** apply a mobile keyboard rule on desktop pointer devices.
2. Initial scoped CSS proposal:
   ```css
   @media (max-width: 639px) and (pointer: coarse) {
     .app-shell:has(
       input:not([type]):focus,
       input:is([type="text"], [type="email"], [type="password"],
         [type="search"], [type="tel"], [type="url"], [type="number"]):focus,
       textarea:focus
     ) .app-bottom-nav {
       display: none;
     }
   }
   ```
   The precise supported input types/select-picker treatment should be aligned with the existing app forms. Keep the `@supports selector(:has(*))` boundary or compatible fallback. **This is a proposed patch, not yet applied.**
3. Address the related `.expense-save-footer` `:has(input:focus,...)` rule, which can also jump during checkbox/submit focus handoff.
4. For mobile text-entry → submit interactions, verify that the tab bar does **not** reappear during a finger/pointer gesture. If the focus-only approach still shifts the overlay while the keyboard closes, replace that **one shared behavior** with keyboard-state-aware visibility (for example via `VisualViewport` and an explicit state transition); do not add per-page timeout hacks.
5. Ensure scroll/viewport padding keeps controls out of the tab bar's hit region when it is visible. No `force: true`, `dispatchEvent("click")`, direct API POST, global `pointer-events:none` on nav or removal of the actual consent gate.

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

**Root cause category established through deterministic browser A/B:** focus-driven bottom navigation reappears between pointerdown and pointerup, intercepting the click, so the React handler and HTTP POST never fire. **Actual-app pointer-target confirmation is the sole outstanding causal check before the proposed CSS remediation.** The previous blanket focus selector is a cross-app UX hazard; address it centrally, not inside the snapshot API or individual Playwright assertions.
