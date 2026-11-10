import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyRoute, isAllowedApiMutation, isUnsafeMethod, safeReturnTo,
} from "../lib/security/route-policy.ts";

test("public entry points, Better Auth and cron remain available", () => {
  for (const path of ["/", "/sign-in", "/sign-up", "/invite/test-token", "/apple-icon"]) {
    assert.equal(classifyRoute(path), "public-page", path);
  }
  assert.equal(classifyRoute("/api/auth/get-session"), "auth-api");
  assert.equal(classifyRoute("/api/auth/sign-up/email"), "auth-api");
  assert.equal(classifyRoute("/api/internal/push-drain"), "internal-cron");
  assert.equal(classifyRoute("/api/internal/settlement-ops/status"), "internal-cron");
  assert.equal(classifyRoute("/api/internal/settlement-ops/runtime"), "internal-cron");
});
test("future private routes default to protection; segment boundaries matter", () => {
  for (const path of ["/groups", "/groups/aaa/expenses/new", "/debts",
    "/activity", "/settings", "/unexpected-admin-page", "/sign-in-other",
    "/apple-icon-admin", "/apple-icon/private"]) {
    assert.equal(classifyRoute(path), "private-page", path);
  }
  for (const path of ["/api/groups/1/expenses", "/api/debts", "/api/notifications",
    "/api/push/subscriptions", "/api/internal/unknown", "/api/settlements"]) {
    assert.equal(classifyRoute(path), "private-api", path);
  }
  assert.equal(classifyRoute("/api/authentic/other"), "private-api");
});
test("Origin and Fetch Metadata guard state-changing cookie API requests", () => {
  const host = "https://group-expense.vercel.app";
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    assert.equal(isUnsafeMethod(method), true);
    assert.equal(isAllowedApiMutation(method, host, host, "same-origin"), true);
    assert.equal(isAllowedApiMutation(method, host, "https://evil.example", "cross-site"), false);
    assert.equal(isAllowedApiMutation(method, host, "https://group-expense.vercel.app.evil.example", null), false);
    assert.equal(isAllowedApiMutation(method, host, host + "/extra", "same-origin"), false);
    assert.equal(isAllowedApiMutation(method, host, "null", null), false);
    assert.equal(isAllowedApiMutation(method, host, null, null), false);
    assert.equal(isAllowedApiMutation(method, host, host, "cross-site"), false);
  }
  for (const method of ["GET", "HEAD", "OPTIONS"]) {
    assert.equal(isAllowedApiMutation(method, host, null, "cross-site"), true);
  }
});
test("returnTo remains a local route, never an external or auth/API redirect", () => {
  assert.equal(safeReturnTo("/groups/abc?view=all"), "/groups/abc?view=all");
  assert.equal(safeReturnTo("/invite/xyz"), "/invite/xyz");
  for (const input of [null, "", "https://evil.example", "//evil.example",
    "/\\evil.example", "/%2f%2fevil.example", "/%5cevil.example",
    "/api/settlements", "/sign-in", "/sign-up?returnTo=evil",
    "/groups%0aSet-Cookie:bad", "/" + "x".repeat(2100)]) {
    assert.equal(safeReturnTo(input), "/groups", String(input));
  }
});
