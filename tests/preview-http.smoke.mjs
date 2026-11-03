import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes, createHash } from "node:crypto";
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
    // Ingress policy: anonymous pages redirect, APIs return JSON 401.
    const anonymousPage=await fetch(`${origin}/groups?tab=recent`,{
      redirect:"manual",signal:AbortSignal.timeout(10_000),
    });
    assert.equal(anonymousPage.status,307);
    assert.equal(new URL(anonymousPage.headers.get("location"), origin).pathname,"/sign-in");
    assert.equal(new URL(anonymousPage.headers.get("location"), origin).searchParams.get("returnTo"),
      "/groups?tab=recent");
    assert.equal(anonymousPage.headers.get("x-frame-options"),"DENY");
    assert.equal(anonymousPage.headers.get("cache-control"),"private, no-store");

    const anonymousAPI=await fetch(`${origin}/api/debts`,{
      redirect:"manual",signal:AbortSignal.timeout(10_000),
    });
    assert.equal(anonymousAPI.status,401);
    assert.equal((await anonymousAPI.json()).code,"UNAUTHENTICATED");
    assert.equal(anonymousAPI.headers.get("cache-control"),"private, no-store");

    const cronWithoutBearer=await fetch(`${origin}/api/internal/push-drain`,{
      redirect:"manual",signal:AbortSignal.timeout(10_000),
    });
    assert.equal(cronWithoutBearer.status,401,"cron relies on its separate Bearer secret");
    assert.equal((await fetch(`${origin}/sw.js`)).status,200,
      "public push worker must bypass authentication");
    assert.equal((await fetch(`${origin}/offline.html`)).status,200,
      "public offline fallback must bypass authentication");

    const forgedCookie=await fetch(`${origin}/groups`,{
      headers:{cookie:"better-auth.session_token=forged"},
      redirect:"manual",signal:AbortSignal.timeout(10_000),
    });
    // With Partial Prerendering + Suspense, Next.js can emit HTTP 200 with a
    // streaming redirect marker instead of an early 307. Both are safe only
    // when no protected group data is rendered.
    if (forgedCookie.status === 307) {
      assert.equal(new URL(forgedCookie.headers.get("location"), origin).pathname,"/sign-in");
    } else {
      assert.equal(forgedCookie.status,200,"unexpected forged-cookie page status");
      const html = await forgedCookie.text();
      assert.match(html, /NEXT_REDIRECT|http-equiv=["']refresh|__next-page-redirect/,
        "streamed page must contain a Next.js sign-in redirect marker");
      assert.doesNotMatch(html, /Nhóm của tôi/,
        "forged cookies must never render private group content");
    }
    const forgedApi=await fetch(`${origin}/api/debts`,{
      headers:{cookie:"better-auth.session_token=forged"},
      redirect:"manual",signal:AbortSignal.timeout(10_000),
    });
    assert.equal(forgedApi.status,401,
      "a fake session cookie must fail the server-side Better Auth verification");

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
    const groupsHtml = await groupScreen.text();
    assert.match(groupsHtml, /Nhóm của tôi/);
    // Native-feeling PWA shell is rendered server-side, not added only after hydration.
    assert.match(groupsHtml, /Tạo nhóm mới/, "mobile create group section must be present");
    assert.match(groupsHtml, /Nhóm đang tham gia/, "group list should be separately labelled");
    assert.match(groupsHtml, /Điều hướng chính/, "tab navigation should be accessible");
    assert.match(groupsHtml, /Công nợ/, "financial tab should remain available");
    assert.match(groupsHtml, /Thông báo/, "notifications tab should remain available");
    assert.match(groupsHtml, /viewport-fit=cover/, "iOS installed PWA should use safe-area viewport");


    // Create-group form uses a stable JSON endpoint, never a redirecting
    // Server Action that destroys unsaved input on validation errors.
    const createGroupUrl=`${origin}/api/groups`;
    const createRequest=async(body,cookies=jar)=>fetch(createGroupUrl,{
      method:"POST",redirect:"manual",
      headers:{"Content-Type":"application/json",origin,
        ...(cookies.size?{cookie:cookieHeader(cookies)}:{})},
      body:JSON.stringify(body),signal:AbortSignal.timeout(10_000),
    });
    assert.equal((await createRequest({name:"A test group"},new Map())).status,401);
    assert.equal((await createRequest({name:"x"})).status,400);
    const createdGroup=await createRequest({name:"A group created from JSON"});
    assert.equal(createdGroup.status,201);
    assert.equal(createdGroup.headers.get("location"),null);
    const createdGroupId=(await createdGroup.json()).id;
    assert.match(createdGroupId,/^[0-9a-f-]{36}$/);
    const createdGroupRow=await pool.query(
      "SELECT g.name,m.role FROM groups g JOIN group_members m ON m.group_id=g.id AND m.user_id=$2 WHERE g.id=$1",
      [createdGroupId,registered.user.id]);
    assert.equal(createdGroupRow.rows[0].name,"A group created from JSON");
    assert.equal(createdGroupRow.rows[0].role,"owner");
    const invalidInvite=await fetch(`${origin}/api/invites/accept`,{
      method:"POST",redirect:"manual",
      headers:{"Content-Type":"application/json",origin,cookie:cookieHeader(jar)},
      body:JSON.stringify({token:"invalid"}),signal:AbortSignal.timeout(10_000),
    });
    assert.equal(invalidInvite.status,400);
    assert.equal(invalidInvite.headers.get("location"),null,
      "invalid invite must not navigate away from the invitation screen");

    // The HTTP layer is exercised against disposable PostgreSQL, not Neon.
    const groupId = randomUUID();
    await pool.query("INSERT INTO groups(id, owner_id, name) VALUES ($1,$2,$3)",
      [groupId, registered.user.id, "Integration group"]);
    await pool.query("INSERT INTO group_members(group_id,user_id,role) VALUES($1,$2,'owner')",
      [groupId, registered.user.id]);
    // Group management is a standalone page, never a native <details> that
    // gets closed/remounted by Server Actions or router.refresh().
    const managePath=`/groups/${groupId}/manage`;
    const groupDetailsResponse=await fetch(`${origin}/groups/${groupId}`,{
      headers:{cookie:cookieHeader(jar)},signal:AbortSignal.timeout(10_000),
    });
    assert.equal(groupDetailsResponse.status,200);
    const detailHtml=await groupDetailsResponse.text();
    assert.match(detailHtml,new RegExp(`/groups/${groupId}/manage`),
      "group details must link to the dedicated management page");
    assert.doesNotMatch(detailHtml,/<details(?:\\s|>)/i,
      "the old auto-collapsing management disclosure must be removed");
    const manageResponse=await fetch(`${origin}${managePath}`,{
      headers:{cookie:cookieHeader(jar)},signal:AbortSignal.timeout(10_000),
    });
    assert.equal(manageResponse.status,200);
    const manageHtml=await manageResponse.text();
    for(const heading of [
      "Quản lý nhóm","Thông tin nhóm","Thành viên và quyền hạn",
      "Chuyển quyền sở hữu","Rời nhóm","Mời thành viên","Lưu trữ nhóm",
    ])assert.match(manageHtml,new RegExp(heading),"missing management action: "+heading);
    assert.doesNotMatch(manageHtml,/<details(?:\\s|>)/i,
      "interactive management controls must never be nested in a toggle");

    // UI regression: management mutations respond in place (JSON) and do not
    // redirect the browser or discard in-progress form state.
    assert.match(manageHtml,/Lưu tên nhóm/);
    assert.match(manageHtml,/Lưu trữ nhóm/);
    assert.doesNotMatch(manageHtml,/action="[^"]*\?_rsc=/);
    const renameUrl=`${origin}/api/groups/${groupId}/rename`;
    const renameRequest=async(body,sessionJar=jar)=>fetch(renameUrl,{
      method:"PATCH",redirect:"manual",
      headers:{"content-type":"application/json",origin,
        ...(sessionJar.size?{cookie:cookieHeader(sessionJar)}:{})},
      body:JSON.stringify(body),signal:AbortSignal.timeout(10_000),
    });
    assert.equal((await renameRequest({name:"Anonymous change"},new Map())).status,401);
    assert.equal((await renameRequest({name:"x"})).status,400);
    const renamed=await renameRequest({name:"Renamed integration group"});
    assert.equal(renamed.status,200);
    assert.equal(renamed.headers.get("location"),null,
      "rename must never perform a page redirect");
    assert.equal((await renamed.json()).name,"Renamed integration group");
    const renamedDb=await pool.query("SELECT name FROM groups WHERE id=$1",[groupId]);
    assert.equal(renamedDb.rows[0].name,"Renamed integration group");
    const refreshedManage=await fetch(`${origin}${managePath}`,{
      headers:{cookie:cookieHeader(jar)},signal:AbortSignal.timeout(10_000),
    });
    assert.equal(refreshedManage.status,200);
    assert.match(await refreshedManage.text(),/Renamed integration group/);

    const archiveGroupId=randomUUID();
    await pool.query("INSERT INTO groups(id,owner_id,name) VALUES ($1,$2,'Empty archive group')",
      [archiveGroupId,registered.user.id]);
    await pool.query(`INSERT INTO group_members(group_id,user_id,role)
      VALUES($1,$2,'owner')`,[archiveGroupId,registered.user.id]);
    const archiveUrl=`${origin}/api/groups/${archiveGroupId}/archive`;
    const archiveRequest=async(body,sessionJar=jar)=>fetch(archiveUrl,{
      method:"POST",redirect:"manual",
      headers:{"content-type":"application/json",origin,
        ...(sessionJar.size?{cookie:cookieHeader(sessionJar)}:{})},
      body:JSON.stringify(body),signal:AbortSignal.timeout(10_000),
    });
    assert.equal((await archiveRequest({confirmation:"Empty archive group"},new Map())).status,401);
    assert.equal((await archiveRequest({confirmation:"Wrong name"})).status,409);
    assert.equal((await pool.query("SELECT archived_at FROM groups WHERE id=$1",
      [archiveGroupId])).rows[0].archived_at,null);
    const archived=await archiveRequest({confirmation:"Empty archive group"});
    assert.equal(archived.status,200);
    assert.equal(archived.headers.get("location"),null,
      "archive endpoint must not force navigation or redirect on its own");
    assert.equal((await archived.json()).archived,true);
    assert.ok((await pool.query("SELECT archived_at FROM groups WHERE id=$1",
      [archiveGroupId])).rows[0].archived_at);

    const anonManage=await fetch(`${origin}${managePath}`,{
      redirect:"manual",signal:AbortSignal.timeout(10_000),
    });
    assert.equal(anonManage.status,307,
      "group management must require an authenticated session");

    const inviteApi=`/api/groups/${groupId}/invites`;
    assert.equal((await post(inviteApi,{},new Map())).status,401,
      "anonymous users cannot generate invitation links");
    const invited=await post(inviteApi,{},jar);
    assert.equal(invited.status,201,"owner should generate links without page navigation");
    const invitedBody=await invited.json();
    assert.match(invitedBody.token,/^[A-Za-z0-9_-]{32,100}$/,
      "new invitation token should be URL-safe");
    const storedInvite=await pool.query(
      "SELECT id FROM group_invites WHERE token_hash=$1 AND group_id=$2",
      [createHash("sha256").update(invitedBody.token).digest("hex"),groupId],
    );
    assert.equal(storedInvite.rowCount,1,"invitation must persist in Postgres");
    const endpoint = `${origin}/api/groups/${groupId}/expenses`;
    const rejectedOrigin=await fetch(endpoint,{
      method:"POST",redirect:"manual",
      headers:{"content-type":"application/json",
        cookie:cookieHeader(jar),origin:"https://evil.example"},
      body:JSON.stringify({}),signal:AbortSignal.timeout(10_000),
    });
    assert.equal(rejectedOrigin.status,403,
      "financial writes must reject cross-origin cookie requests");
    assert.equal((await rejectedOrigin.json()).code,"INVALID_ORIGIN");
    const missingOrigin=await fetch(endpoint,{
      method:"POST",redirect:"manual",
      headers:{"content-type":"application/json",cookie:cookieHeader(jar)},
      body:JSON.stringify({}),signal:AbortSignal.timeout(10_000),
    });
    assert.equal(missingOrigin.status,403,"cookie API writes require Origin");
    const crossSite=await fetch(endpoint,{
      method:"POST",redirect:"manual",
      headers:{"content-type":"application/json",cookie:cookieHeader(jar),
        origin,"sec-fetch-site":"cross-site"},
      body:JSON.stringify({}),signal:AbortSignal.timeout(10_000),
    });
    assert.equal(crossSite.status,403,"Fetch Metadata cross-site writes are blocked");

    async function expenseRequest(method, url, data, cookieJar = jar) {
      const response = await fetch(url, {
        method, headers: { "content-type": "application/json",
          ...(method === "GET" ? {} : { origin }),
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
    assert.equal((await post(inviteApi,{},otherJar)).status,403,
      "non-members must not generate group invitations");
    const otherManage=await fetch(`${origin}${managePath}`,{
      headers:{cookie:cookieHeader(otherJar)},redirect:"manual",
      signal:AbortSignal.timeout(10_000),
    });
    if(otherManage.status===200){
      const html=await otherManage.text();
      assert.match(html,/NEXT_HTTP_ERROR_FALLBACK|NEXT_NOT_FOUND|404/,
        "non-member manage page must render not-found, never private controls");
      assert.doesNotMatch(html, /Chuyển quyền sở hữu/,
        "non-members may not see owner management controls");
    }else{
      assert.equal(otherManage.status,404);
    }

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
    const inboxUrl=`${origin}/api/notifications`;
    assert.equal((await expenseRequest("GET",inboxUrl,undefined,new Map())).response.status,401,
      "notification inbox must require authentication");
    const pushConfiguration=await expenseRequest("GET",`${origin}/api/push/subscriptions`,undefined,otherJar);
    assert.equal(pushConfiguration.response.status,200);
    assert.equal(pushConfiguration.body.configured,false,
      "CI does not configure VAPID; in-app must still work");
    assert.equal((await expenseRequest("POST",`${origin}/api/push/subscriptions`,{},otherJar)).response.status,503,
      "push opt-in must be disabled until VAPID configured");
    const beforeNotify=(await expenseRequest("GET",inboxUrl,undefined,jar)).body;
    assert.equal(beforeNotify.unreadCount,0);

    const made=await expenseRequest("POST",settlementUrl,firstPayload,otherJar);
    assert.equal(made.response.status,201,JSON.stringify(made.body));

    const ownerInbox=(await expenseRequest("GET",inboxUrl,undefined,jar)).body;
    assert.equal(ownerInbox.unreadCount,1);
    assert.equal(ownerInbox.notifications.length,1);
    assert.equal(ownerInbox.notifications[0].kind,"settlement_requested");
    assert.equal(ownerInbox.notifications[0].readAt,null);
    assert.equal(ownerInbox.notifications[0].href,
      `/groups/${groupId}/settlements/${made.body.id}`);
    assert.equal((await expenseRequest("GET",inboxUrl,undefined,otherJar)).body.unreadCount,0,
      "initiator does not receive their own request notification");
    const firstNotice=ownerInbox.notifications[0].id;
    assert.equal((await expenseRequest("PATCH",`${inboxUrl}/${firstNotice}`,{},otherJar)).response.status,404,
      "notifications are private to their recipient");
    assert.equal((await expenseRequest("PATCH",`${inboxUrl}/${firstNotice}`,{},jar)).response.status,200);
    assert.equal((await expenseRequest("GET",inboxUrl,undefined,jar)).body.unreadCount,0);
    assert.equal((await expenseRequest("PATCH",`${inboxUrl}/${firstNotice}`,{},jar)).response.status,200,
      "mark read must be idempotent");

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

    const rejectedInbox=(await expenseRequest("GET",inboxUrl,undefined,otherJar)).body;
    assert.equal(rejectedInbox.unreadCount,1);
    assert.equal(rejectedInbox.notifications[0].kind,"settlement_rejected");

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

    const cancelledInbox=(await expenseRequest("GET",inboxUrl,undefined,otherJar)).body;
    assert.equal(cancelledInbox.unreadCount,3); // reject + request + cancel
    assert.equal(cancelledInbox.notifications[0].kind,"settlement_cancelled",
      "cancel must notify the counterpart, not the initiator");

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

    const confirmedInbox=(await expenseRequest("GET",inboxUrl,undefined,otherJar)).body;
    assert.equal(confirmedInbox.notifications[0].kind,"settlement_confirmed");
    assert.equal(confirmedInbox.unreadCount,4); // confirmed plus the previous three
    assert.equal((await expenseRequest("POST",`${inboxUrl}/read-all`,{},otherJar)).response.status,200);
    assert.equal((await expenseRequest("GET",inboxUrl,undefined,otherJar)).body.unreadCount,0);
    const pageOne=(await expenseRequest("GET",`${inboxUrl}?limit=1`,undefined,otherJar)).body;
    assert.equal(pageOne.notifications.length,1);
    assert.ok(pageOne.nextCursor);
    const pageTwo=(await expenseRequest("GET",
      `${inboxUrl}?limit=1&cursor=${pageOne.nextCursor}`,undefined,otherJar)).body;
    assert.equal(pageTwo.notifications.length,1);
    assert.notEqual(pageTwo.notifications[0].id,pageOne.notifications[0].id);

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


    // Every successful settlement transition has exactly one persisted notification.
    const noticeStats=await pool.query(
      `SELECT kind,count(*)::int AS total FROM notifications WHERE group_id=$1
       GROUP BY kind ORDER BY kind`,[groupId]);
    assert.ok(noticeStats.rows.some(x=>x.kind==="settlement_requested"&&x.total>=3));
    assert.ok(noticeStats.rows.some(x=>x.kind==="settlement_confirmed"&&x.total>=1));
    assert.ok(noticeStats.rows.some(x=>x.kind==="settlement_rejected"&&x.total>=1));
    assert.ok(noticeStats.rows.some(x=>x.kind==="settlement_cancelled"&&x.total>=1));

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


    // Group lifecycle: blocked by debt/pending, soft leave, rejoin and ownership.
    const bLeave=`${origin}/api/groups/${groupId}/membership/leave`;
    const cLeave=bLeave;
    const transferUrl=`${origin}/api/groups/${groupId}/membership/transfer`;
    const memberUrl=id=>`${origin}/api/groups/${groupId}/membership/members/${id}`;
    assert.equal((await expenseRequest("POST",bLeave,undefined,new Map())).response.status,401);
    assert.equal((await expenseRequest("POST",bLeave,undefined,jar)).response.status,409,
      "owner cannot leave before transferring ownership");
    const bStatus=await expenseRequest("GET",bLeave,undefined,otherJar);
    assert.equal(bStatus.response.status,200);
    assert.equal(bStatus.body.eligibility.canLeave,false);
    assert.equal(bStatus.body.eligibility.reason,"unsettled");
    assert.ok(BigInt(bStatus.body.eligibility.toPayMinor)>0n);
    assert.equal((await expenseRequest("POST",bLeave,undefined,otherJar)).response.status,409,
      "debtor cannot leave with active obligations");
    assert.equal((await expenseRequest("DELETE",memberUrl(otherUser.id),undefined,jar)).response.status,409,
      "owner cannot remove member with unsettled debts");
    assert.equal((await expenseRequest("POST",transferUrl,{targetId:thirdUser.id},otherJar)).response.status,403);

    const cStatus=await expenseRequest("GET",cLeave,undefined,thirdJar);
    assert.equal(cStatus.response.status,200);
    assert.equal(cStatus.body.eligibility.canLeave,true,
      "historical deleted/retired obligations must not block a fully settled member");
    const oldCItems=await pool.query(
      `SELECT count(*)::int AS total FROM expense_item_shares s
       JOIN expense_items i ON i.id=s.item_id
       WHERE i.expense_id=$1 AND s.user_id=$2`,[debtExpenseId,thirdUser.id]);
    assert.ok(oldCItems.rows[0].total>0);
    assert.equal((await expenseRequest("POST",cLeave,undefined,thirdJar)).response.status,200);
    const afterC=await pool.query(
      "SELECT status,left_at,role FROM group_members WHERE group_id=$1 AND user_id=$2",
      [groupId,thirdUser.id]);
    assert.equal(afterC.rows[0].status,"left");
    assert.ok(afterC.rows[0].left_at);
    assert.equal((await expenseRequest("GET",debtEndpoint,undefined,thirdJar)).response.status,404,
      "former member cannot read private group debts");
    assert.equal((await expenseRequest("GET",endpoint,undefined,thirdJar)).response.status,404,
      "former member cannot access group bills");
    const badMemberDraft={...draft,items:[
      {name:"Former member food",quantity:1,unitPriceMinor:"10000",participants:[thirdUser.id]}]};
    assert.equal((await expenseRequest("POST",endpoint,badMemberDraft)).response.status,400,
      "former members cannot be added to new expense splits");
    assert.equal((await expenseRequest("POST",endpoint,{...draft,payerId:thirdUser.id})).response.status,400,
      "former members cannot pay new expenses");

    const invitation=randomBytes(32).toString("base64url");
    await pool.query(
      `INSERT INTO group_invites(id,group_id,token_hash,created_by,expires_at)
       VALUES($1,$2,$3,$4,now()+interval '7 days')`,
      [randomUUID(),groupId,createHash("sha256").update(invitation).digest("hex"),registered.user.id]);
    const rejoinUrl=`${origin}/api/invites/accept`;
    const joined=await expenseRequest("POST",rejoinUrl,{token:invitation},thirdJar);
    assert.equal(joined.response.status,200,JSON.stringify(joined.body));
    assert.equal(joined.body.groupId,groupId);
    assert.equal((await expenseRequest("POST",rejoinUrl,{token:invitation},thirdJar)).response.status,200,
      "repeated invite acceptance must not create duplicate membership");
    const restored=await pool.query(
      "SELECT role,status,left_at,rejoined_at FROM group_members WHERE group_id=$1 AND user_id=$2",
      [groupId,thirdUser.id]);
    assert.equal(restored.rowCount,1);
    assert.equal(restored.rows[0].status,"active");
    assert.equal(restored.rows[0].role,"member");
    assert.equal(restored.rows[0].left_at,null);
    assert.ok(restored.rows[0].rejoined_at);
    assert.equal((await expenseRequest("GET",debtEndpoint,undefined,thirdJar)).response.status,200);
    assert.equal((await expenseRequest("POST",transferUrl,{targetId:thirdUser.id},jar)).response.status,200,
      "only current owner can transfer to active member");
    const ownerAfter=await pool.query(
      `SELECT g.owner_id,m.role FROM groups g
       JOIN group_members m ON m.group_id=g.id AND m.user_id=g.owner_id WHERE g.id=$1`,
      [groupId]);
    assert.equal(ownerAfter.rows[0].owner_id,thirdUser.id);
    assert.equal(ownerAfter.rows[0].role,"owner");
    assert.equal((await expenseRequest("POST",cLeave,undefined,thirdJar)).response.status,409,
      "new owner must transfer first");
    assert.equal((await expenseRequest("DELETE",memberUrl(otherUser.id),undefined,jar)).response.status,403,
      "former owner with role member cannot remove others");
    assert.equal((await expenseRequest("DELETE",memberUrl(otherUser.id),undefined,thirdJar)).response.status,409,
      "new owner cannot bypass debtor balances");
    const aReceivables=await expenseRequest("GET",bLeave,undefined,jar);
    assert.equal(aReceivables.response.status,200);
    assert.ok(BigInt(aReceivables.body.eligibility.toReceiveMinor)>0n,
      "creditor cannot leave while money is still owed");

    const bOwes=(await expenseRequest("GET",debtEndpoint)).body.debts
      .filter(x=>x.debtorId===otherUser.id && BigInt(x.outstandingMinor)>0n);
    assert.ok(bOwes.length>=1);
    const finalize=await expenseRequest("POST",settlementUrl,{
      requestKey:randomUUID(),
      allocations:bOwes.map(x=>({obligationId:x.id,amountMinor:x.outstandingMinor})),
      note:"finish financial clearance before group exit"
    },otherJar);
    assert.equal(finalize.response.status,201,JSON.stringify(finalize.body));
    const finalizeUrl=`${settlementUrl}/${finalize.body.id}`;
    const pendingB=await expenseRequest("GET",bLeave,undefined,otherJar);
    assert.equal(pendingB.body.eligibility.reason,"pending");
    assert.equal((await expenseRequest("POST",bLeave,undefined,otherJar)).response.status,409,
      "pending settlement still blocks exit");
    assert.equal((await expenseRequest("PATCH",finalizeUrl,{action:"confirm"},jar)).response.status,200);
    assert.equal((await expenseRequest("GET",bLeave,undefined,otherJar)).body.eligibility.canLeave,true);
    assert.equal((await expenseRequest("POST",bLeave,undefined,otherJar)).response.status,200);
    assert.equal((await expenseRequest("GET",debtEndpoint,undefined,otherJar)).response.status,404);
    const settledMembership=await pool.query(
      "SELECT status FROM group_members WHERE group_id=$1 AND user_id=$2",
      [groupId,otherUser.id]);
    assert.equal(settledMembership.rows[0].status,"left");
    const activeOwnerStatus=await expenseRequest("GET",bLeave,undefined,jar);
    assert.equal(activeOwnerStatus.body.eligibility.canLeave,true,
      "creditor must become eligible after all confirmed payments");
    assert.equal((await expenseRequest("DELETE",memberUrl(registered.user.id),undefined,thirdJar)).response.status,200,
      "owner may remove settled ordinary member without deleting history");
    assert.equal((await expenseRequest("GET",endpoint,undefined,jar)).response.status,404,
      "removed member cannot read old receipts");
    const archiveHistory=await pool.query(
      `SELECT count(*)::int AS events FROM group_membership_events WHERE group_id=$1`,
      [groupId]);
    assert.ok(archiveHistory.rows[0].events>=5);
    const persistedFinancial=await pool.query(
      `SELECT (SELECT count(*)::int FROM obligations WHERE group_id=$1) AS obligations,
       (SELECT count(*)::int FROM settlements WHERE group_id=$1) AS settlements`,[groupId]);
    assert.ok(persistedFinancial.rows[0].obligations>=4);
    assert.ok(persistedFinancial.rows[0].settlements>=3);

    // Concurrent leave versus new allocation: both must never succeed.
    const raceGroup=randomUUID();
    await pool.query("INSERT INTO groups(id,owner_id,name) VALUES($1,$2,'Lifecycle race group')",
      [raceGroup,registered.user.id]);
    await pool.query(`INSERT INTO group_members(group_id,user_id,role)
      VALUES($1,$2,'owner'),($1,$3,'member')`,
      [raceGroup,registered.user.id,otherUser.id]);
    const raceEndpoint=`${origin}/api/groups/${raceGroup}/expenses`;
    const [raceLeave,raceExpense]=await Promise.all([
      expenseRequest("POST",`${origin}/api/groups/${raceGroup}/membership/leave`,undefined,otherJar),
      expenseRequest("POST",raceEndpoint,{...draft,items:[
        {name:"Race meal",quantity:1,unitPriceMinor:"25000",participants:[otherUser.id]}]}),
    ]);
    const successCount=[raceLeave.response.status,raceExpense.response.status]
      .filter(code=>code===200||code===201).length;
    assert.equal(successCount,1,
      `group-level locks must prevent leave/new-debt race: ${raceLeave.response.status}/${raceExpense.response.status}`);
    const afterRace=await pool.query(
      "SELECT status FROM group_members WHERE group_id=$1 AND user_id=$2",
      [raceGroup,otherUser.id]);
    const activeDebts=await pool.query(
      `SELECT count(*)::int AS total FROM obligations
       WHERE group_id=$1 AND debtor_id=$2 AND voided_at IS NULL`,
      [raceGroup,otherUser.id]);
    assert.ok(!(afterRace.rows[0].status==="left" && activeDebts.rows[0].total>0),
      "departed member must never have newly-created outstanding debt");

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
