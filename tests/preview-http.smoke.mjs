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


    // The HTTP layer is exercised against disposable PostgreSQL, not Neon.
    const groupId = randomUUID();
    await pool.query("INSERT INTO groups(id, owner_id, name) VALUES ($1,$2,$3)",
      [groupId, registered.user.id, "Integration group"]);
    await pool.query("INSERT INTO group_members(group_id,user_id,role) VALUES($1,$2,'owner')",
      [groupId, registered.user.id]);
    const endpoint = `${origin}/api/groups/${groupId}/expenses`;
    async function expenseRequest(method, url, data, cookieJar = jar) {
      const response = await fetch(url, {
        method, headers: { "content-type": "application/json",
          ...(cookieJar.size ? { cookie: cookieHeader(cookieJar) } : {}) },
        ...(data === undefined ? {} : { body: JSON.stringify(data) }),
        signal: AbortSignal.timeout(10_000),
      });
      const body = await response.json();
      return { response, body };
    }
    const draft = {
      title: "Mua đồ dùng", notes: "2 dòng", occurredOn: "2026-11-03",
      payerId: registered.user.id,
      items: [
        { name: "Gạo", quantity: 2, unitPriceMinor: "15000", participants: [registered.user.id] },
        { name: "Trứng", quantity: 1, unitPriceMinor: "10000", participants: [registered.user.id] },
      ],
    };
    const unauth = await expenseRequest("POST", endpoint, draft, new Map());
    assert.equal(unauth.response.status, 401, "unauthenticated writes must fail");
    const otherJar = new Map();
    const otherEmail = `other-${randomUUID()}@example.test`;
    const otherSignup = await post("/api/auth/sign-up/email",
      { name: "Other Tester", email: otherEmail, password }, otherJar);
    assert.ok(otherSignup.ok, "second test user must sign up");
    const otherUser = (await otherSignup.json()).user;
    assert.equal((await expenseRequest("POST", endpoint, draft, otherJar)).response.status, 404,
      "non-member must not create expenses in another group");
    assert.equal((await expenseRequest("GET", endpoint, undefined, otherJar)).response.status, 404,
      "non-member must not list expenses in another group");
    await pool.query("INSERT INTO group_members(group_id,user_id,role) VALUES($1,$2,'member')",
      [groupId, otherUser.id]);

    const createdExpense = await expenseRequest("POST", endpoint, draft);
    assert.equal(createdExpense.response.status, 201,
      `expense POST returned ${createdExpense.response.status}: ${JSON.stringify(createdExpense.body)}`);
    assert.equal(createdExpense.body.version, 1);
    const expenseId = createdExpense.body.id;
    const detailUrl = `${endpoint}/${expenseId}`;
    const detailed = await expenseRequest("GET", detailUrl);
    assert.equal(detailed.response.status, 200);
    assert.equal(detailed.body.expense.totalMinor, "40000");
    assert.equal(detailed.body.expense.items.length, 2);
    assert.equal(detailed.body.expense.items[0].shares[0].amountMinor, "30000");
    assert.equal((await expenseRequest("PATCH", detailUrl,
      { expectedVersion: 1, expense: draft }, otherJar)).response.status, 403,
      "non-creator member must not edit another member's expense");
    assert.equal((await expenseRequest("DELETE", detailUrl,
      { expectedVersion: 1 }, otherJar)).response.status, 403,
      "non-creator member must not delete another member's expense");
    const duplicateWrongVersion = await expenseRequest("PATCH", detailUrl,
      { expectedVersion: 999, expense: draft });
    assert.equal(duplicateWrongVersion.response.status, 409);
    const malformed = await expenseRequest("PATCH", detailUrl, {
      expectedVersion: 1, expense: { ...draft,
        items: [{ ...draft.items[0], participants: ["nonexistent-member"] }] }
    });
    assert.equal(malformed.response.status, 400);
    const edited = await expenseRequest("PATCH", detailUrl,
      { expectedVersion: 1, expense: { ...draft, title: "Đã sửa" } });
    assert.equal(edited.response.status, 200);
    assert.equal(edited.body.version, 2);
    const revisions = await pool.query("SELECT operation, version FROM expense_events WHERE expense_id=$1 ORDER BY version", [expenseId]);
    assert.deepEqual(revisions.rows, [
      { operation: "created", version: 1 }, { operation: "updated", version: 2 }
    ]);
    const removed = await expenseRequest("DELETE", detailUrl, { expectedVersion: 2 });
    assert.equal(removed.response.status, 200);
    assert.equal((await expenseRequest("GET", detailUrl)).response.status, 404);
    assert.equal((await expenseRequest("PATCH", detailUrl,
      { expectedVersion: 2, expense: draft })).response.status, 404);
    const retained = await pool.query("SELECT count(*)::int AS count FROM expense_events WHERE expense_id=$1", [expenseId]);
    assert.equal(retained.rows[0].count, 3);

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
