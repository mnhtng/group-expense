import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveDatabaseUrl } from "../db/connection.mjs";

const pooled = "postgresql://role:fake@ep-sample-pooler.us-east-1.aws.neon.tech/neondb?sslmode=require";
const direct = "postgresql://role:fake@ep-sample.us-east-1.aws.neon.tech/neondb?sslmode=require";

test("runtime uses Neon pooled URL and migrations use direct URL", () => {
  assert.equal(resolveDatabaseUrl("runtime", { DATABASE_URL: pooled }), pooled);
  assert.equal(resolveDatabaseUrl("migration", { DATABASE_URL: pooled, DATABASE_URL_DIRECT: direct }), direct);
});
test("Neon migration fails without direct URL", () => {
  assert.throws(() => resolveDatabaseUrl("migration", { DATABASE_URL: pooled }), /DATABASE_URL_DIRECT/);
});
test("Neon migration refuses pooled URLs and mismatched databases", () => {
  assert.throws(() => resolveDatabaseUrl("migration", { DATABASE_URL: pooled, DATABASE_URL_DIRECT: pooled }), /must be direct/);
  assert.throws(() => resolveDatabaseUrl("migration", { DATABASE_URL: pooled, DATABASE_URL_DIRECT: direct.replace("/neondb?", "/wrong?") }), /same Neon endpoint/);
});
test("Neon URLs must request TLS", () => {
  assert.throws(() => resolveDatabaseUrl("runtime", { DATABASE_URL: pooled.replace("?sslmode=require", "") }), /sslmode/);
  assert.throws(() => resolveDatabaseUrl("migration", { DATABASE_URL: pooled, DATABASE_URL_DIRECT: direct.replace("?sslmode=require", "") }), /sslmode/);
});
test("local PostgreSQL remains compatible with existing CI", () => {
  const local = "postgresql://test:test@localhost:5432/group_expense";
  assert.equal(resolveDatabaseUrl("migration", { DATABASE_URL: local }), local);
});
test("invalid and empty URLs are rejected without exposing credentials", () => {
  assert.throws(() => resolveDatabaseUrl("migration", {}), /DATABASE_URL/);
  assert.throws(() => resolveDatabaseUrl("runtime", { DATABASE_URL: "not a url" }), /PostgreSQL URL/);
});
