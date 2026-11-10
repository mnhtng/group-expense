import { test } from "node:test";
import assert from "node:assert/strict";
import { installGuide } from "../lib/pwa/install-support.ts";

const env = (userAgent, platform = "", maxTouchPoints = 0) =>
  ({userAgent, platform, maxTouchPoints});

test("iPhone browsers and iPad desktop mode receive Home Screen instructions", () => {
  for (const suffix of ["Version/18.0 Safari/605.1.15", "CriOS/150.0", "FxiOS/150.0", "EdgiOS/150.0"]) {
    assert.match(installGuide(env(`Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) ${suffix}`)), /Thêm vào Màn hình chính/);
  }
  assert.match(installGuide(env("Mozilla/5.0 (Macintosh) Version/18.0 Safari/605.1.15", "MacIntel", 5)), /Màn hình chính/);
});

test("Safari Mac guide requires Safari 17 and does not misidentify Chromium", () => {
  const mac = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)";
  assert.match(installGuide(env(`${mac} Version/17.0 Safari/605.1.15`)), /macOS Sonoma 14.*Add to Dock/);
  assert.equal(installGuide(env(`${mac} Version/16.4 Safari/605.1.15`)), null);
  for (const browser of ["Chrome/150.0", "Chromium/150.0", "Edg/150.0", "OPR/130.0"]) {
    assert.equal(installGuide(env(`${mac} ${browser} Version/17.0 Safari/605.1.15`)), null);
  }
});

test("Firefox guides distinguish Android, supported Windows, and other desktops", () => {
  assert.match(installGuide(env("Mozilla/5.0 (Android 15; Mobile) Firefox/150.0")), /menu ⋮.*Install.*Màn hình chính/);
  assert.match(installGuide(env("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Firefox/143.0")), /thanh địa chỉ.*Microsoft Store.*150/);
  for (const ua of ["Mozilla/5.0 (Windows NT 10.0) Firefox/142.0", "Mozilla/5.0 (Macintosh) Firefox/150.0", "Mozilla/5.0 (X11; Linux x86_64) Firefox/150.0"]) {
    assert.equal(installGuide(env(ua)), null);
  }
});

test("embedded mobile browsers guide users to an external browser first", () => {
  for (const marker of ["FBAN/FBIOS", "FBAV/500", "Instagram", "Zalo", "Line/15", "WebView"]) {
    assert.match(installGuide(env(`Mozilla/5.0 (iPhone) ${marker}`)), /menu của ứng dụng.*Mở bằng Safari/);
  }
  assert.match(installGuide(env("Mozilla/5.0 (Linux; Android 15; Pixel 9; wv) Chrome/150.0 Safari/537.36")), /Mở bằng Chrome/);
  assert.match(installGuide(env("Mozilla/5.0 (Android 15) Zalo")), /Mở bằng Chrome/);
});

test("native prompt browsers and unknown browsers do not get speculative manual guides", () => {
  for (const ua of ["", "UnknownBrowser", "Mozilla/5.0 (Android 15) Chrome/150.0 Safari/537.36", "Mozilla/5.0 (Windows NT 10.0) Chrome/150.0 Edg/150.0 Safari/537.36", "Mozilla/5.0 (Linux; Android 15) SamsungBrowser/30.0 Chrome/150.0 Safari/537.36"]) {
    assert.equal(installGuide(env(ua)), null);
  }
});
