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

    // Sprint 3: source-traceable obligations for two distinct debtors.
    const thirdJar = new Map();
    const thirdEmail = `third-${randomUUID()}@example.test`;
    const thirdSignup = await post("/api/auth/sign-up/email",
      { name: "Third Tester", email: thirdEmail, password }, thirdJar);
    assert.ok(thirdSignup.ok, "third test user must sign up");
    const thirdUser = (await thirdSignup.json()).user;
    const debtEndpoint = `${origin}/api/groups/${groupId}/debts`;
    assert.equal((await expenseRequest("GET", debtEndpoint, undefined, thirdJar)).response.status, 404,
      "group debts must be invisible to outsiders");
    assert.equal((await expenseRequest("GET", debtEndpoint, undefined, new Map())).response.status, 401,
      "group debts require auth");
    await pool.query("INSERT INTO group_members(group_id,user_id,role) VALUES($1,$2,'member')",
      [groupId, thirdUser.id]);

    const debtDraft = {
      title: "130k itemized receipt", notes: "two traceable debts",
      occurredOn: "2026-11-03", payerId: registered.user.id,
      items: [
        { name: "B meal", quantity: 1, unitPriceMinor: "55000", participants: [otherUser.id] },
        { name: "C meal", quantity: 1, unitPriceMinor: "65000", participants: [thirdUser.id] },
        { name: "Payer own item", quantity: 1, unitPriceMinor: "10000", participants: [registered.user.id] },
      ],
    };
    const receipt = await expenseRequest("POST", endpoint, debtDraft);
    assert.equal(receipt.response.status, 201,
      `debt receipt: ${JSON.stringify(receipt.body)}`);
    const debtExpenseId = receipt.body.id;
    const groupDebts = await expenseRequest("GET", debtEndpoint);
    assert.equal(groupDebts.response.status, 200);
    assert.equal(groupDebts.body.debts.length, 2);
    assert.deepEqual(
      groupDebts.body.debts.map(x => [x.debtorId, x.amountMinor])
        .sort((a, b) => a[0].localeCompare(b[0])),
      [[otherUser.id, "55000"], [thirdUser.id, "65000"]]
        .sort((a, b) => a[0].localeCompare(b[0])),
    );
    const myDebts = await expenseRequest("GET", `${origin}/api/debts`);
    assert.equal(myDebts.response.status, 200);
    assert.equal(myDebts.body.debts.length, 2);
    assert.deepEqual(myDebts.body.debts.map(x => x.amountMinor).sort(), ["55000", "65000"]);
    const debtorDebts = await expenseRequest("GET", `${origin}/api/debts`, undefined, otherJar);
    assert.equal(debtorDebts.body.debts.length, 1);
    assert.equal(debtorDebts.body.debts[0].direction, "pay");
    assert.equal(debtorDebts.body.debts[0].amountMinor, "55000");
    const B = groupDebts.body.debts.find(x => x.debtorId === otherUser.id);
    const traced = await expenseRequest("GET", `${debtEndpoint}/${B.id}`, undefined, otherJar);
    assert.equal(traced.response.status, 200);
    assert.equal(traced.body.sources.length, 1);
    assert.equal(traced.body.sources[0].itemName, "B meal");
    assert.equal(traced.body.sources[0].amountMinor, "55000");
    assert.equal((await expenseRequest("GET", `${debtEndpoint}/${B.id}`, undefined,
      new Map())).response.status, 401);

    const revisedDraft = { ...debtDraft, items: [
      { ...debtDraft.items[0], unitPriceMinor: "60000" },
      ...debtDraft.items.slice(1)
    ] };
    const revised = await expenseRequest("PATCH", `${endpoint}/${debtExpenseId}`,
      { expectedVersion: 1, expense: revisedDraft });
    assert.equal(revised.response.status, 200);
    const afterEdit = await expenseRequest("GET", debtEndpoint);
    assert.deepEqual(afterEdit.body.debts.map(x => x.amountMinor).sort(), ["60000", "65000"],
      "editing receipt must update active amounts, not double count old obligations");
    const historic = await pool.query(
      `SELECT expense_version AS version, (voided_at IS NOT NULL) AS voided,
         count(*)::int AS count FROM obligations WHERE expense_id=$1
         GROUP BY expense_version, voided_at IS NOT NULL ORDER BY expense_version`,
      [debtExpenseId],
    );
    assert.deepEqual(historic.rows, [
      { version: 1, voided: true, count: 2 },
      { version: 2, voided: false, count: 2 },
    ]);
    const auditSources = await pool.query(
      `SELECT count(*)::int AS count FROM obligation_sources s
       JOIN obligations o ON o.id=s.obligation_id WHERE o.expense_id=$1`, [debtExpenseId]
    );
    assert.equal(auditSources.rows[0].count, 4,
      "item snapshots must survive revision's item deletion");
    const removingReceipt = await expenseRequest("DELETE", `${endpoint}/${debtExpenseId}`,
      { expectedVersion: 2 });
    assert.equal(removingReceipt.response.status, 200);
    assert.equal((await expenseRequest("GET", debtEndpoint)).body.debts.length, 0,
      "deleting expense must retire all current obligations");
    const historicalRows = await pool.query(
      "SELECT count(*)::int AS count FROM obligations WHERE expense_id=$1",
      [debtExpenseId],
    );
    assert.equal(historicalRows.rows[0].count, 4, "historical obligations must remain");


    // Sprint 4: directional, partial, multi-obligation payment confirmations.
    const receipt2 = await expenseRequest("POST", endpoint, {
      ...debtDraft, title: "Second receipt",
      items:[{name:"B other item",quantity:1,unitPriceMinor:"35000",
        participants:[otherUser.id]}],
    });
    assert.equal(receipt2.response.status,201);
    const sprint4Rows=(await expenseRequest("GET",debtEndpoint)).body.debts;
    const bDebts=sprint4Rows.filter(x=>x.debtorId===otherUser.id);
    assert.equal(bDebts.length,1, "first receipt was deleted; only 35k B debt should remain");
    const source35=bDebts[0].id;
    const settlementUrl=`${origin}/api/groups/${groupId}/settlements`;
    const firstPayload={requestKey:randomUUID(),
      allocations:[{obligationId:source35,amountMinor:"15000"}],note:"reported by debtor"};
    const unauthorizedPay=await expenseRequest("POST",settlementUrl,firstPayload,new Map());
    assert.equal(unauthorizedPay.response.status,401);
    assert.equal((await expenseRequest("POST",settlementUrl,firstPayload,thirdJar)).response.status,403,
      "only the debtor or creditor can report a payment");
    const made=await expenseRequest("POST",settlementUrl,firstPayload,otherJar);
    assert.equal(made.response.status,201,JSON.stringify(made.body));
    assert.equal((await expenseRequest("POST",settlementUrl,firstPayload,otherJar)).response.status,200,
      "same request key is idempotent");
    const alteredKey=await expenseRequest("POST",settlementUrl,{
      ...firstPayload,allocations:[{obligationId:source35,amountMinor:"10000"}]},otherJar);
    assert.equal(alteredKey.response.status,409,"request-key payload mismatch");
    const settlementId=made.body.id, settlementDetailUrl=`${settlementUrl}/${settlementId}`;
    const before=(await expenseRequest("GET",debtEndpoint)).body.debts
      .find(x=>x.id===source35);
    assert.equal(before.outstandingMinor,"35000","pending must NOT reduce principal");
    assert.equal(before.pendingMinor,"15000","pending must reserve available balance");
    assert.equal(before.availableMinor,"20000");
    assert.equal((await expenseRequest("PATCH",`${endpoint}/${receipt2.body.id}`,
      {expectedVersion:1,expense:{...debtDraft,title:"can't edit",items:[
        {name:"B",quantity:1,unitPriceMinor:"35000",participants:[otherUser.id]}]}})).response.status,409,
      "expense with pending payments must be immutable");
    assert.equal((await expenseRequest("POST",settlementUrl,{
      requestKey:randomUUID(),allocations:[{obligationId:source35,amountMinor:"21000"}],
    },otherJar)).response.status,409,"pending reservation must avoid over-allocation");
    assert.equal((await expenseRequest("PATCH",settlementDetailUrl,{action:"confirm"},otherJar)).response.status,403,
      "initiator must never confirm");
    assert.equal((await expenseRequest("PATCH",settlementDetailUrl,{action:"reject"},thirdJar)).response.status,403,
      "unrelated member must never resolve");
    const rejected=await expenseRequest("PATCH",settlementDetailUrl,{action:"reject"},jar);
    assert.equal(rejected.response.status,200);
    assert.equal(rejected.body.status,"rejected");
    assert.equal((await expenseRequest("PATCH",settlementDetailUrl,{action:"confirm"},jar)).response.status,409,
      "terminal settlement can't be processed twice");
    const afterReject=(await expenseRequest("GET",debtEndpoint)).body.debts.find(x=>x.id===source35);
    assert.equal(afterReject.pendingMinor,"0");
    assert.equal(afterReject.availableMinor,"35000");

    const cancelReq=await expenseRequest("POST",settlementUrl,{
      requestKey:randomUUID(),allocations:[{obligationId:source35,amountMinor:"10000"}],
      note:"creditor reported receiving money"
    },jar);
    assert.equal(cancelReq.response.status,201);
    const cancelUrl=`${settlementUrl}/${cancelReq.body.id}`;
    assert.equal((await expenseRequest("PATCH",cancelUrl,{action:"cancel"},otherJar)).response.status,403,
      "counterparty cannot cancel");
    assert.equal((await expenseRequest("PATCH",cancelUrl,{action:"cancel"},jar)).response.status,200);
    assert.equal((await expenseRequest("GET",debtEndpoint)).body.debts
      .find(x=>x.id===source35).availableMinor,"35000");

    // Create two live obligations for the SAME debtor/creditor and settle both in one request.
    const receipt3=await expenseRequest("POST",endpoint,{
      ...debtDraft,title:"Third receipt",items:[
        {name:"B item 2",quantity:1,unitPriceMinor:"40000",participants:[otherUser.id]}],
    });
    assert.equal(receipt3.response.status,201);
    const bPair=(await expenseRequest("GET",debtEndpoint)).body.debts
      .filter(x=>x.debtorId===otherUser.id);
    assert.equal(bPair.length,2);
    const source40=bPair.find(x=>x.id!==source35).id;
    const multiReq=await expenseRequest("POST",settlementUrl,{
      requestKey:randomUUID(),
      allocations:[{obligationId:source35,amountMinor:"20000"},
        {obligationId:source40,amountMinor:"25000"}],
      note:"one transfer for two original receipts"
    },otherJar);
    assert.equal(multiReq.response.status,201,JSON.stringify(multiReq.body));
    const multiUrl=`${settlementUrl}/${multiReq.body.id}`;
    const detailPayment=await expenseRequest("GET",multiUrl);
    assert.equal(detailPayment.response.status,200);
    assert.equal(detailPayment.body.settlement.allocations.length,2);
    assert.equal(detailPayment.body.settlement.amountMinor,"45000");
    const confirmed=await expenseRequest("PATCH",multiUrl,{action:"confirm"},jar);
    assert.equal(confirmed.response.status,200);
    assert.equal(confirmed.body.status,"confirmed");
    assert.equal((await expenseRequest("PATCH",multiUrl,{action:"confirm"},jar)).response.status,409);
    const balances=(await expenseRequest("GET",debtEndpoint)).body.debts;
    assert.equal(balances.find(x=>x.id===source35).outstandingMinor,"15000");
    assert.equal(balances.find(x=>x.id===source40).outstandingMinor,"15000");
    assert.equal((await expenseRequest("GET",`${origin}/api/debts`,undefined,otherJar)).body.debts
      .find(x=>x.direction==="pay").amountMinor,"30000");
    assert.equal((await expenseRequest("DELETE",`${endpoint}/${receipt3.body.id}`,
      {expectedVersion:1})).response.status,409,"confirmed source cannot be deleted");
    const events=await pool.query(
      "SELECT event_type FROM settlement_events WHERE settlement_id=$1 ORDER BY recorded_at",
      [multiReq.body.id]);
    assert.deepEqual(events.rows.map(x=>x.event_type),["created","confirmed"]);
    const [raceA,raceB]=await Promise.all([
      expenseRequest("POST",settlementUrl,{requestKey:randomUUID(),
        allocations:[{obligationId:source35,amountMinor:"12000"}]},otherJar),
      expenseRequest("POST",settlementUrl,{requestKey:randomUUID(),
        allocations:[{obligationId:source35,amountMinor:"12000"}]},otherJar),
    ]);
    assert.deepEqual([raceA.response.status,raceB.response.status].sort(),[201,409],
      "serialized concurrent requests cannot reserve more than available");
    const winner=raceA.response.status===201?raceA:raceB;
    assert.equal((await expenseRequest("PATCH",
      `${settlementUrl}/${winner.body.id}`,{action:"cancel"},otherJar)).response.status,200);

    // Racy confirm vs reject: exactly one terminal transition may win.
    const terminalRaceReq=await expenseRequest("POST",settlementUrl,{
      requestKey:randomUUID(),
      allocations:[{obligationId:source35,amountMinor:"5000"}],
    },otherJar);
    assert.equal(terminalRaceReq.response.status,201);
    const terminalUrl=`${settlementUrl}/${terminalRaceReq.body.id}`;
    const [confirmRace,rejectRace]=await Promise.all([
      expenseRequest("PATCH",terminalUrl,{action:"confirm"},jar),
      expenseRequest("PATCH",terminalUrl,{action:"reject"},jar),
    ]);
    assert.deepEqual([confirmRace.response.status,rejectRace.response.status].sort(),[200,409],
      "only one terminal settlement action can succeed");
    const terminalEvents=await pool.query(
      "SELECT event_type FROM settlement_events WHERE settlement_id=$1 ORDER BY recorded_at",
      [terminalRaceReq.body.id],
    );
    assert.equal(terminalEvents.rows.length,2);
    assert.equal(terminalEvents.rows[0].event_type,"created");
    assert.ok(["confirmed","rejected"].includes(terminalEvents.rows[1].event_type));

    const integrity=await pool.query(
      `SELECT count(*)::int AS total, sum(amount_minor)::text AS allocated
       FROM settlement_allocations WHERE settlement_id=$1`,[multiReq.body.id]);
    assert.equal(integrity.rows[0].total,2);
    assert.equal(integrity.rows[0].allocated,"45000");

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
