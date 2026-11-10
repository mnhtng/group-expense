# Mobile PWA layout baseline

## Issue and design goals
The previous `/groups` mobile screen compressed the text input and Create Group
button into one row, relied on text-only bottom tabs, and did not consistently
reserve iOS standalone safe-area padding. It used the same small
`px-5 py-8` layout independently in different pages.

## New shared conventions
- `app/layout.tsx`: explicit `viewportFit: "cover"`, responsive viewport
  and theme color for installed mobile PWAs.
- `app/(app)/layout.tsx`: `.app-shell` wrapper reserves enough document
  space for the fixed tab bar **plus bottom safe area**, so form buttons are not
  hidden below the tabs.
- `app/globals.css`: `.app-page` with consistent 24px mobile horizontal
  padding, safe-area-aware top/side insets, and 32px padding on wider screens.
  Form fields use at least 48px height and 16px fonts to prevent iOS autozoom;
  buttons have at least 44px touch targets.
- `components/notifications/notification-nav.tsx`: stable four-column native
  icon + caption navigation, large touch targets, active-state highlighting,
  a notification badge and bottom `env(safe-area-inset-bottom)` support.
- `app/(app)/groups/page.tsx`: on mobile, Create Group is a stacked form with
  a full-width action; section heading, count and group cards have clear
  hierarchy and comfortable touch areas. On wider screens input/button return
  to a row.
- All authenticated screens use the same app-page layout, including bills,
  settlements, debts, activity and settings. Existing logic and database
  permissions remain unchanged.

## Manual QA matrix
1. iPhone SE width (320/375 CSS px), standard 390px iPhone, 430px iPhone Pro
   Max and 360–412px Android.
2. Safari PWA installed to Home Screen, iOS Safari in browser, Android Chrome
   standalone, desktop 768px and wider.
3. Inspect notch/clock and Home Indicator: tabs and primary actions must never
   overlap the system safe area.
4. Open keyboard in Create Group and in expense input: input must not cause
   iOS zoom, buttons should remain accessible after scrolling.
5. Check long Vietnamese group names, large VND values and unread badge.
6. Check `/groups`, `/debts`, `/activity`, `/settings`, group details, bills,
   expense creation/edit and settlement screens; no horizontal overflow.
7. Device-specific screenshots are still required for *visual* signoff. CI
   validates compile, routes and server-rendered mobile navigation but is
   not a substitute for an iOS/Android screenshot comparison.

## Rollout
Feature branch → CI + PostgreSQL integration → `develop` Preview. The
production `main` branch remains unchanged until a separate release.
