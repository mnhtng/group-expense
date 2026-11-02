import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import pg from "pg";

const port = 3101;
const origin = `http://127.0.0.1:${port}`;
const pollIntervalMs = 600;

async function waitForReady(server, timeoutMs = 25_000) {
  const expires = Date.now() + timeoutMs;
  let lastProbe = "not started";
  while (Date.now() < expires) {
    if (server.exitCode !== null) throw new Error(`Next.js server exited during startup: ${server.exitCode}`);
    try {
      const response = await fetch(`${origin}/sign-in`, {
        redirect: "manual",
        signal: AbortSignal.timeout(2500),
      });
      lastProbe = `HTTP ${response.status}`;
      if (response.ok) return;
    } catch (error) {
      lastProbe = error?.cause?.code ?? error?.code ?? error?.message ?? "unknown error";
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
  throw new Error(`Next.js /sign-in did not become healthy within 25 seconds; last probe: ${lastProbe}`);
}

function updateCookieJar(jar, response) {
  for (const header of response.headers.getSetCookie()) {
    const pair = header.split(";", 1)[0];
    const delimiter = pair.indexOf("=");
    if (delimiter === -1) continue;
    const name = pair.slice(0, delimiter);
    const value = pair.slice(delimiter + 1);
    if (value === "") jar.delete(name);
    else jar.set(name, value);
  }
}

function cookieHeader(jar) {
  return [...jar].map(([key, value]) => `${key}=${value}`).join("; ");
}

async function post(path, body, jar) {
  const response = await fetch(`${origin}${path}`, {
    method: "POST",
    redirect: "manual",
    headers: {
      "content-type": "application/json",
      origin,
      ...(jar.size ? { cookie: cookieHeader(jar) } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  updateCookieJar(jar, response);
  return response;
}

async function session(jar) {
  const response = await fetch(`${origin}/api/auth/get-session`, {
    headers: jar.size ? { cookie: cookieHeader(jar) } : {},
    signal: AbortSignal.timeout(10_000),
  });
  assert.equal(response.status, 200, "get-session must return HTTP 200");
  return response.json();
}

test("Next.js HTTP -> Better Auth -> Postgres -> signed session -> logout", { timeout: 160_000 }, async () => {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for HTTP integration tests");
  const server = spawn(
    process.execPath,
    ["node_modules/next/dist/bin/next", "start", "-p", String(port)],
    { env: { ...process.env, BETTER_AUTH_URL: origin }, stdio: "ignore" },
  );
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await waitForReady(server);
    const health = await fetch(`${origin}/api/auth/ok`, { signal: AbortSignal.timeout(10_000) });
    assert.equal(health.status, 200, `/api/auth/ok returned HTTP ${health.status}`);
    const healthPayload = await health.json();
    assert.ok(healthPayload && typeof healthPayload === "object", "/api/auth/ok must return JSON");
    const anonymous = await session(new Map());
    assert.equal(anonymous, null, "anonymous visitors must have no session");

    const jar = new Map();
    const email = `http-smoke-${randomUUID()}@example.test`;
    const password = "Smoke-test-password-123!";
    const signup = await post("/api/auth/sign-up/email", { name: "Smoke Tester", email, password }, jar);
    assert.ok(signup.ok, `signup endpoint returned HTTP ${signup.status}`);
    const registered = await signup.json();
    assert.equal(registered.user.email, email);
    assert.ok(jar.size > 0, "signup should issue an authentication cookie");

    const activeSession = await session(jar);
    assert.equal(activeSession?.user?.email, email);
    assert.ok(activeSession?.session?.id, "session must have a database-backed ID");

    const dbSession = await pool.query(
      'SELECT "expiresAt" FROM "session" WHERE "userId" = $1',
      [registered.user.id],
    );
    assert.ok(dbSession.rowCount > 0);
    assert.ok(
      new Date(dbSession.rows[0].expiresAt).getTime() > Date.now() + 300 * 24 * 60 * 60 * 1000,
      "persistent session should be valid for roughly one year",
    );

    const groupScreen = await fetch(`${origin}/groups`, {
      headers: { cookie: cookieHeader(jar) },
      signal: AbortSignal.timeout(10_000),
    });
    assert.ok(groupScreen.ok, `authenticated /groups returned HTTP ${groupScreen.status}`);
    assert.match(await groupScreen.text(), /Nhóm của tôi/);

    const logout = await post("/api/auth/sign-out", {}, jar);
    assert.ok(logout.ok, `sign-out returned HTTP ${logout.status}`);
    assert.equal(await session(jar), null, "logout must revoke the session");

    const wrongPassword = await post(
      "/api/auth/sign-in/email",
      { email, password: "incorrect-password-123" },
      jar,
    );
    assert.ok(wrongPassword.status >= 400 && wrongPassword.status < 500);
    assert.equal(await session(jar), null, "wrong password must never create a session");

    const login = await post("/api/auth/sign-in/email", { email, password, rememberMe: true }, jar);
    assert.ok(login.ok, `sign-in returned HTTP ${login.status}`);
    assert.equal((await session(jar))?.user?.email, email);
  } finally {
    await pool.end();
    server.kill("SIGTERM");
  }
});
