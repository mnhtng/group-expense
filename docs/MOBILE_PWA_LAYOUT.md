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

## Compact install banner
- The root layout includes a single 44px row (45px including its border), in
  normal document flow, with a download icon, Install button and Close button.
- Chromium shows it when `beforeinstallprompt` confirms installation is
  available. The button opens the browser's install confirmation; accepting or
  declining consumes that prompt. A fresh browser event permits another try.
- iPhone/iPad browser tabs show an expandable Safari Home Screen guide instead.
  Safari 17+ on Mac shows Add to Dock instructions with the macOS Sonoma 14+
  requirement. Firefox on Android shows its Install menu; Firefox 143+ on
  Windows shows the address-bar web app button instructions, including the
  Firefox 150+ requirement for Microsoft Store installations.
- Recognized mobile embedded browsers (Facebook, Instagram, Zalo, LINE and
  Android WebViews) explain how to open the page in Safari/Chrome first.
  User-agent recognition is best effort; unknown embedded browsers may not
  expose installation and must be checked on devices.
- Manual-install browsers cannot reliably report an existing installation
  from a regular tab, so a previously installed app may still see its guide
  when visiting in the browser. Opening an installed standalone app hides it.
- Installed display modes and `appinstalled` hide the banner. Closing it hides
  it for the current tab session, including reloads and navigation. Other
  browsers without a native prompt or a known manual flow hide the banner.
- Manifest PNG icons at 192px and 512px reuse the existing SVG artwork.
- `/apple-icon?<hash>` is explicitly public in the ingress policy. It returns
  the 180px Apple PNG before login; similar paths remain protected.
- Device QA: install with Android Chrome, launch from the new icon and verify
  the banner is absent; repeat the manual Home Screen flow on iPhone/iPad.
  Browser event simulation does not replace installation on physical devices.

Installation instructions follow [Apple's iPhone guide](https://support.apple.com/guide/iphone/open-as-web-app-iphea86e5236/ios),
[Safari on Mac](https://support.apple.com/en-gb/104996),
[Firefox Android](https://support.mozilla.org/en-US/kb/use-web-apps-firefox-android)
and [Firefox Windows](https://support.mozilla.org/en-US/kb/web-apps-firefox-windows).

## Rollout
Feature branch → CI + PostgreSQL integration → `develop` Preview. The
production `main` branch remains unchanged until a separate release.
