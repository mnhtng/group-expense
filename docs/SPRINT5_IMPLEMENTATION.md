# Sprint 5 — Notification Center, Web Push and PWA

Status: implementation targeting `develop` Preview. `main` stays production.

## Features

- Persistent **recipient-owned** in-app notifications for settlement requests, confirmations,
  rejections and cancellations.
- New settlement notifications target the **other party**. Confirm/reject target the
  initiator; cancellation targets the counterparty. No self-notifications.
- Notifications are inserted in the **same SQL transaction** as the financial transition.
  A failed financial transaction leaves no notification.
- Unique `recipient_id,settlement_id,kind` ensures retries cannot duplicate notifications.
- Notification inbox `/activity`, unread badge (25s polling on visible pages),
  read one/read all, cursor pagination; anonymous access is rejected.
- Per-device Web Push subscriptions, opt-in browser permission, logout unsubscribe attempt.
  Subscription endpoints are validated against trusted Apple/Google/Mozilla hosts.
- Notification push outbox retries failed sends; `after()` on successful HTTP mutations
  attempts immediate delivery without blocking the financial response.
- Browser service worker `/sw.js` handles push and click navigation.
  **No offline caching of sessions, financial data or private pages.**
- Existing SVG app icon and PWA manifest remain, with manifest shortcuts.

## Privacy, keys and deployment

Generate one stable P-256 VAPID key pair per environment and set in **Vercel Preview
scoped only to Git branch `develop`**:

| Name | Purpose |
|---|---|
| `VAPID_PUBLIC_KEY` | Public P-256 key for `PushManager.subscribe` |
| `VAPID_PRIVATE_KEY` | Private signing key. Never place in Git or browser bundle |
| `VAPID_SUBJECT` | Real `https:` contact URL or `mailto:` contact |
| `CRON_SECRET` | Restrict retry route `/api/internal/push-drain` |

In-app notifications work even if VAPID variables are absent. Web Push opt-in is disabled
until keys are configured. VAPID key rotation invalidates existing browser subscriptions.

`vercel.json` configures a daily `02:00 UTC` retry (compatible with Hobby).
**Vercel Cron only runs in Production, not Preview**, so the immediate `after()`
dispatch path handles Preview deliveries. With a Pro plan, retry cadence may be
increased if configured and funded. Cron authentication uses `Authorization: Bearer
<CRON_SECRET>`. Do not expose secrets in logs or screenshots.

Browsers require an HTTPS secure context. On iOS/iPadOS, Web Push is supported for
eligible web apps added to the Home Screen and after user permission. Always ask
for permission in a user interaction. Browser/provider capabilities vary.

## Validation and rollout gates

- CI: SQL migrations 001–006 twice, TypeScript, lint, build, unit, and PostgreSQL
  HTTP integration tests.
- Settlement notifications remain user-scoped, read/unread follows ownership,
  duplicate requests do not create extra notifications.
- RFC 8291 AES-128-GCM ECDH encryption round-trip and RFC 8292 VAPID ES256 signature
  have unit tests; **real push delivery needs end-to-end testing with a subscribed
  Chrome/Firefox/Safari device**. Provider acceptance is not confirmed by crypto tests.
- Apply `006_notifications.sql` to Neon **development only** after CI passes.
- Merge feature PR to `develop`, verify Vercel Preview and the 8 environment variable
  names without exposing values.
- Before releasing to production, apply migrations 001–006 on the production DB via
  a separate release process, configure separate VAPID keys and `CRON_SECRET`, and
  validate browser push and authorization under the Production domain.

## Boundaries

No message body is cached by the service worker. The notification action represents
an external payment confirmation; Group Expense never initiates a bank transfer.
An in-app unread count is refreshed periodically, not a WebSocket stream.
