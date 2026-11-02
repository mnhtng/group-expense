import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { betterAuth } from "better-auth";
import pg from "pg";

test("Better Auth registers and authenticates using SQL migration schema", async () => {
  if (!process.env.DATABASE_URL) return;
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const auth = betterAuth({
    database: pool,
    baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
    secret: process.env.BETTER_AUTH_SECRET ?? "ci-test-secret-at-least-32-chars-long",
    emailAndPassword: { enabled: true, minPasswordLength: 10 },
    session: { expiresIn: 365 * 24 * 60 * 60, updateAge: 24 * 60 * 60 },
  });
  try {
    const email = `ci-${randomUUID()}@example.com`;
    const password = "A-strong-password-123!";
    const registered = await auth.api.signUpEmail({ body: { name: "CI Tester", email, password } });
    assert.equal(registered.user.email, email);
    const logged = await auth.api.signInEmail({ body: { email, password, rememberMe: true } });
    assert.equal(logged.user.email, email);
    const sessions = await pool.query(
      'SELECT "userId", "expiresAt" FROM "session" WHERE "userId" = $1',
      [registered.user.id],
    );
    assert.ok(sessions.rowCount >= 1, "registered user must have database-backed session");
    assert.ok(new Date(sessions.rows[0].expiresAt).getTime() > Date.now());
  } finally {
    await pool.end();
  }
});
