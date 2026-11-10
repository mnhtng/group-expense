# RR-002 — Physical iOS/Android & installed PWA acceptance

**Status:** Test protocol prepared; **NO physical-device PASS evidence yet**. The four-profile Playwright matrix was PASS on a Mac on 2026-11-07, but Chromium/WebKit emulation is not a real iPhone or Android phone.

**Owner of this gate:** a human tester with the actual devices and access to a **separately approved, isolated HTTPS test deployment**. This document does not authorize a deployment, migration, finance engine activation, public tunnel, or use of production data. Keep PR #16 Draft, `SETTLEMENT_CYCLE_ENGINE_READY=false`.

## 0. Environment gate (required before any phone opens the site)

- The operator identifies the tested Git commit (`git rev-parse HEAD`), tested URL, deployment ID, database branch and their independent approver. Record only **non-secret resource identifiers**.
- The PWA URL is **HTTPS with a certificate trusted by both physical phones**. A Mac's `http://localhost` is a secure-context exception only **on the Mac itself**; a phone opening `http://192.168.x.x:port` does **not** inherit that exception. Do not disable browser certificate verification or expose the ephemeral `rr002-local.sh` server on a public interface.
- Use **synthetic identities, invoices, disputes and balances** only. No shared Neon development/production data, payment provider calls, or real personal transactions. No screenshot of cookies, request bodies, authentication tokens, private keys, account email or other private information.
- `RR002_TEST_ONLY` and financial test-write bypass flags are **never** enabled in a reachable deployment. No test should depend on enabled settlement-money writers.
- The operator inspects the served `manifest.webmanifest` and `sw.js`, confirms `isSecureContext=true`, and tests browser installability rather than assuming the emulated manifest HTTP 200 proves a valid installable PWA. **The current manifest uses an SVG icon marked `sizes:any`; Chromium installability/icon-compatibility on physical hardware remains an explicit open check.** Do not mark installation PASS just because the icon file loads.
- Do not begin device signoff until a reviewed isolated HTTPS environment with seeded safe data exists. Creating such an environment requires separate authorization.

Reference: [MDN secure-context / installability](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable) and [Apple instructions for adding a web app to Home Screen](https://support.apple.com/guide/iphone/turn-a-website-into-an-app-iphea86e5236/ios).

## 1. Required hardware and test setup

- **iPhone:** actual iPhone, record device model, iOS version, Safari version (when known), portrait + landscape where supported. Install using Safari > Share > Add to Home Screen > Open as Web App > Add. Test *both* Safari tab and the **installed Home Screen web app**.
- **Android:** actual Android phone, record manufacturer/model, Android and Chrome versions. Test Chrome tab and the installed PWA (installation UI may depend on device/browser/manifest).
- At least **two signed synthetic roles** are needed to demonstrate private two-person workflows; a third unrelated synthetic member validates that private pair data does not leak. No real email addresses, secrets or money need to be documented.
- Test low-memory/background resume, Wi-Fi disconnect/reconnect, on-screen keyboard, device rotation, accessibility zoom/dynamic font and OS screen reader as applicable.

## 2. Device acceptance matrix

Every item below is **PENDING** until a tester records a real-device result as `PASS`, `FAIL` or `BLOCKED`. Never infer PASS from Playwright emulation.

| ID | Applies to | Manual gesture / condition | Expected result |
|---|---|---|---|
| D01 | Both | Open approved isolated HTTPS origin in Safari/Chrome | Trusted TLS, real app renders, sign-in without redirect loop |
| D02 | Both | Verify web manifest, install from browser, launch Home Screen icon | Actual install works and opens in standalone display where supported |
| D03 | Both | Log in as synthetic owner; close app, background for a realistic interval, force quit and relaunch | Session persists across resume/relaunch; user is not unexpectedly logged out |
| D04 | Both | Open authorized group, cycle list and direct cycle link | No clipped header/safe-area overlap, no unwanted horizontal scroll, deep-link authorization intact |
| D05 | Both | Navigate with on-screen keyboard from text input/textarea to Save/Submit | No lost tap, bottom nav or sticky footer must not steal `pointerup`; input remains visible when keyboard opens |
| D06 | Both | Toggle a checkbox then tap the neighboring confirmation button near bottom of screen | Exactly one action occurs; no ghost/double tap, no mid-gesture overlay jump |
| D07 | Both | Open a 2-party dispute, enter reason, confirm acknowledgment; counterpart responds, original actor resolves | Exactly one immutable event per action; errors/reloads do not fabricate a payment |
| D08 | Both | Switch to unrelated signed user or third member and open a private pair link | Pair-private messages/reasons/settlements are hidden or denied, not merely masked by CSS |
| D09 | Both | Select counterparty and source invoice, expand original-source disclosure | Minimum interactive hit area 44 CSS px; no accidental nav activation |
| D10 | Both | Increase font size/zoom, rotate, inspect long invoice name and 50+ source list | Readable and reachable content; no clipped pay/confirm button or overflow |
| D11 | Both | Put app offline on previously loaded screen, navigate to private financial page | Safe public offline fallback or clear network error; no cached private finance details exposed |
| D12 | Both | Restore connection, tap actual Retry (when available), reload | Reconciliation resumes without stale incorrect money state or forced logout |
| D13 | Both | Back/forward, background app while a request is pending, resume | No duplicate submits or unexpected automatic consent |
| D14 | iOS | Check Safari tab vs Home Screen app behavior, safe area, focus, scroll, keyboard dismissal | No overlapping controls, touch interception or navigation lock |
| D15 | Android | Check Chrome tab vs installed PWA behavior, back button, keyboard open/close | Navigation remains predictable; no duplicate submit or overlay interception |
| D16 | Both | Enable VoiceOver/TalkBack and move through key labels, checkboxes, alerts, actions | Accessible names and focus order are meaningful; error and retry can be reached |
| D17 | Both, if configured | On installed PWA only, request push permission by explicit user gesture and send a synthetic push | Permission flow and notification visible; denial must not break core app |
| D18 | Both | Verify group cycle finance controls while engine is hard OFF | Proposal/apply/payment writers disabled; no real payment or noncash ledger mutation |

**Important restriction:** The signed test users must not be able to execute actual money settlement/ledger writes. A physical run cannot validate the `review -> lock` transition unless a **separately approved isolated fixture** exists with realistic past-cycle data and permissions; record it as `BLOCKED` if no such fixture is available. Do not temporarily enable real financial engine to force a green device test.

## 3. Evidence record (one for each physical device / mode)

Use the template below. Fill it only after the test occurs. Do not replace actual `FAIL` with `PASS` because an emulator passed.

```text
Device evidence ID:
Date/time + timezone:
Reviewer/tester (team identifier only):
OS / browser / device model:
Mode: Safari tab | iOS installed web app | Android Chrome tab | Android installed PWA
Approved isolated HTTPS environment URL (no token):
Deployment commit SHA:
Environment / isolated database branch identifier (no credentials):
Actual secure context / manifest / Service Worker observations:
Test results (D01..D18): PASS / FAIL / BLOCKED / N/A + one-line reason
Redacted evidence filename(s), local-only or approved secure location:
Accessibility / touch / keyboard observations:
Unresolved defects / issue links:
Retest on exact commit:
Signoff: PENDING / APPROVED / REJECTED (human reviewer)
```

Evidence must come from genuine device interactions. Store only synthetic-account screenshots and device version info; do not attach session/cookie exports, push endpoints or URLs with invite/authentication tokens.

## 4. Exit criteria and handoff

1. Physical **iOS Safari + installed Home Screen app** and **Android Chrome + installed PWA** finish the applicable matrix; all critical cases D01–D13, D16, D18 PASS and device-specific D14/D15 PASS; D17 must be evaluated if web push is in the supported release scope.
2. Each run is tied to an approved **isolated HTTPS** environment and exact reviewed source SHA; screenshot/notes corroborate the actual device and mode. Every FAIL is tracked with a fix and retest; every BLOCKED has a clearly named prerequisite.
3. The existing local automated 4-profile browser E2E remains green after device fixes; no skip, `force:true`, synthetic DOM clicks or data-security bypasses.
4. Human reviewer independently signs the evidence. **RR-002 device signoff must remain PENDING** without this. RR-003 provider PITR restore, RR-004 finance/security review and RR-005 staged release still have distinct gates and approvals.
5. Do not merge, deploy to shared staging/production, touch shared Neon, or enable `SETTLEMENT_CYCLE_ENGINE_READY` from this checklist.

**References:** [Browser E2E evidence](./RR-002-BROWSER-E2E.md), [RCA](./RR-002-ROOT-CAUSE-PLAN.md), [Release backlog](./BACKLOG.md).
