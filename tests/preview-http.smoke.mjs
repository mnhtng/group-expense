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
    assert.match(groupsHtml, /Nhóm của bạn/, "group list should be separately labelled");
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

    // SC-001: a separately owned group proves default-OFF feature gate,
    // owner-only delegation and no financial side effects.
    const cycleGroupId=randomUUID();
    await pool.query("INSERT INTO groups(id,owner_id,name) VALUES($1,$2,'SC-001 test group')",
      [cycleGroupId,registered.user.id]);
    await pool.query("INSERT INTO group_members(group_id,user_id,role) VALUES($1,$2,'owner')",
      [cycleGroupId,registered.user.id]);
    await pool.query("INSERT INTO group_members(group_id,user_id,role) VALUES($1,$2,'member')",
      [cycleGroupId,otherUser.id]);
    await pool.query("INSERT INTO group_members(group_id,user_id,role) VALUES($1,$2,'admin')",
      [cycleGroupId,thirdUser.id]);
    const settingsUrl=`${origin}/api/groups/${cycleGroupId}/settlement-cycle/settings`;
    const managersUrl=`${origin}/api/groups/${cycleGroupId}/settlement-cycle/managers`;
    const config=(version,enabled,netting)=>({
      expectedVersion:version,requestedEnabled:enabled,requestedBilateralNetting:netting,
    });
    assert.equal((await expenseRequest("GET",settingsUrl,undefined,new Map())).response.status,401);
    const emptyConfig=await expenseRequest("GET",settingsUrl,undefined,jar);
    assert.equal(emptyConfig.response.status,200);
    assert.deepEqual([
      emptyConfig.body.version,emptyConfig.body.requestedEnabled,
      emptyConfig.body.requestedBilateralNetting,emptyConfig.body.effectiveEnabled,
      emptyConfig.body.canManage,emptyConfig.body.canDelegate,
    ],[0,false,false,false,true,true],"existing groups start with settlement-cycle OFF");
    assert.equal((await expenseRequest("GET",settingsUrl,undefined,thirdJar)).body.canManage,false,
      "group admin does not automatically manage cycles");
    assert.equal((await expenseRequest("PATCH",settingsUrl,config(0,true,false),new Map()))
      .response.status,401);
    assert.equal((await expenseRequest("PATCH",settingsUrl,config(0,true,false),thirdJar))
      .response.status,403,"admin cannot enable ungranted feature");
    assert.equal((await expenseRequest("PATCH",settingsUrl,config(0,true,false),otherJar))
      .response.status,403,"normal member cannot configure cycles");
    assert.equal((await expenseRequest("PATCH",settingsUrl,config(0,false,true),jar))
      .response.status,400,"bilateral netting requires cycle opt-in");
    assert.equal((await expenseRequest("PATCH",settingsUrl,
      {...config(0,true,false),unexpected:true},jar)).response.status,400);
    assert.equal((await expenseRequest("PATCH",settingsUrl,
      {expectedVersion:0,requestedEnabled:"yes",requestedBilateralNetting:false},jar))
      .response.status,400);

    const attempts=await Promise.all([
      expenseRequest("PATCH",settingsUrl,config(0,true,false),jar),
      expenseRequest("PATCH",settingsUrl,config(0,true,false),jar),
    ]);
    assert.deepEqual(attempts.map(x=>x.response.status).sort(),[200,409],
      "concurrent stale PATCH requests cannot overwrite one another");
    assert.equal((await expenseRequest("GET",settingsUrl,undefined,jar)).body.version,1);
    assert.equal((await expenseRequest("PATCH",settingsUrl,config(1,true,true),jar))
      .response.status,200);
    const nettingPrepared=(await expenseRequest("GET",settingsUrl,undefined,jar)).body;
    assert.equal(nettingPrepared.requestedBilateralNetting,true);
    assert.equal(nettingPrepared.effectiveEnabled,false,
      "configured opt-in MUST NOT activate unfinished money logic");
    const disable=await expenseRequest("PATCH",settingsUrl,config(2,false,false),jar);
    assert.equal(disable.response.status,200);
    assert.equal(disable.body.requestedBilateralNetting,false,
      "disabling cycles always disables netting as well");

    assert.equal((await expenseRequest("POST",managersUrl,
      {memberId:otherUser.id,action:"grant"},thirdJar)).response.status,403);
    assert.equal((await expenseRequest("POST",managersUrl,
      {memberId:registered.user.id,action:"grant"},jar)).response.status,400);
    const grant=await expenseRequest("POST",managersUrl,
      {memberId:otherUser.id,action:"grant"},jar);
    assert.equal(grant.response.status,200);
    assert.equal((await expenseRequest("POST",managersUrl,
      {memberId:otherUser.id,action:"grant"},jar)).response.status,409);
    assert.equal((await expenseRequest("GET",settingsUrl,undefined,otherJar)).body.canManage,true);
    assert.equal((await expenseRequest("POST",managersUrl,
      {memberId:thirdUser.id,action:"grant"},otherJar)).response.status,403,
      "delegate cannot delegate");
    const delegated=await expenseRequest("PATCH",settingsUrl,config(3,true,true),otherJar);
    assert.equal(delegated.response.status,200);
    assert.equal(delegated.body.version,4);

    // SC-002: schedule is CONFIGURATION only, independent from money engine.
    const sc002Url=`${origin}/api/groups/${cycleGroupId}/settlement-cycle/schedule`;
    const sc002Date=(()=>{
      const parts=new Intl.DateTimeFormat("en-GB",{
        timeZone:"Asia/Ho_Chi_Minh",year:"numeric",month:"2-digit",day:"2-digit",
      }).formatToParts(new Date());
      const value=k=>parts.find(x=>x.type===k).value;
      return `${value("year")}-${value("month")}-${value("day")}`;
    })();
    const sc002Add=(d,days)=>new Date(Date.parse(d+"T00:00:00Z")+
      days*86400000).toISOString().slice(0,10);
    const sc002Tomorrow=sc002Add(sc002Date,1);
    const sc002Future=sc002Add(sc002Date,8);
    const sc002Config=(version,frequency="weekly",anchorDate=sc002Tomorrow,
      timeZone="Asia/Ho_Chi_Minh")=>({
      expectedVersion:version,frequency,anchorDate,timeZone,
    });
    assert.equal((await expenseRequest("GET",sc002Url,undefined,new Map())).response.status,401);
    const sc002Empty=await expenseRequest("GET",sc002Url,undefined,jar);
    assert.equal(sc002Empty.response.status,200);
    assert.deepEqual([
      sc002Empty.body.version,sc002Empty.body.current,sc002Empty.body.pending,
      sc002Empty.body.effectiveEnabled,sc002Empty.body.canManage,
    ],[0,null,null,false,true],"missing schedule must never activate any cycle");
    assert.equal((await expenseRequest("PATCH",sc002Url,sc002Config(0),thirdJar))
      .response.status,403,"admin without grant may not change period settings");
    assert.equal((await expenseRequest("PATCH",sc002Url,
      {...sc002Config(0), unexpected:"x"},jar)).response.status,400);
    assert.equal((await expenseRequest("PATCH",sc002Url,
      sc002Config(0,"weekly","2026-02-30"),jar)).response.status,400);
    assert.equal((await expenseRequest("PATCH",sc002Url,
      sc002Config(0,"weekly",sc002Tomorrow,"Moon/Base"),jar)).response.status,400);
    assert.equal((await expenseRequest("PATCH",sc002Url,
      sc002Config(0,"daily"),jar)).response.status,400);
    const sc002Concurrent=await Promise.all([
      expenseRequest("PATCH",sc002Url,sc002Config(0),jar),
      expenseRequest("PATCH",sc002Url,sc002Config(0),otherJar),
    ]);
    assert.deepEqual(sc002Concurrent.map(x=>x.response.status).sort(),[200,409],
      "concurrent owner/delegate configuration cannot overwrite each other");
    const sc002Pending=(await expenseRequest("GET",sc002Url,undefined,jar)).body;
    assert.equal(sc002Pending.version,1);
    assert.equal(sc002Pending.current,null);
    assert.equal(sc002Pending.pending.anchorDate,sc002Tomorrow);
    assert.equal(sc002Pending.effectiveEnabled,false);
    assert.equal((await expenseRequest("PATCH",sc002Url,sc002Config(1),jar)).body.version,1,
      "identical pending schedule is idempotent");
    assert.equal((await expenseRequest("PATCH",sc002Url,
      sc002Config(1,"monthly",sc002Future),otherJar)).response.status,200,
      "authorized delegate may replace an unactivated schedule");
    assert.equal((await expenseRequest("PATCH",sc002Url,sc002Config(1),jar))
      .response.status,409,"stale schedule edit rejected");
    const sc002Rows=await pool.query(
      `SELECT count(*)::int AS total,
       count(*) FILTER(WHERE superseded_at IS NULL)::int AS retained
       FROM group_settlement_schedule_revisions WHERE group_id=$1`,[cycleGroupId]);
    assert.deepEqual(sc002Rows.rows[0],{total:2,retained:1},
      "replaced planned revision is retained for audit, but cannot become active");
    assert.equal((await pool.query(
      "SELECT count(*)::int AS n FROM group_settlement_schedule_events WHERE group_id=$1",
      [cycleGroupId])).rows[0].n,2,"no-op and stale requests create no audit events");

    // Test changing a RUNNING schedule without time travel in application
    // code: the isolated fixture creates a historical UTC biweekly anchor.
    const sc002RunningGroup=randomUUID(),sc002OldRevision=randomUUID();
    await pool.query("INSERT INTO groups(id,owner_id,name) VALUES($1,$2,'SC002 running group')",
      [sc002RunningGroup,registered.user.id]);
    await pool.query("INSERT INTO group_members(group_id,user_id,role) VALUES($1,$2,'owner')",
      [sc002RunningGroup,registered.user.id]);
    await pool.query("INSERT INTO group_settlement_schedule_heads(group_id,updated_by) VALUES($1,$2)",
      [sc002RunningGroup,registered.user.id]);
    const sc002Past=sc002Add(sc002Date,-7);
    await pool.query(`INSERT INTO group_settlement_schedule_revisions
      (id,group_id,version,frequency,time_zone,anchor_date,effective_at,created_by)
      VALUES($1,$2,1,'biweekly','UTC',$3,$4,$5)`,
      [sc002OldRevision,sc002RunningGroup,sc002Past,sc002Past+"T00:00:00Z",
        registered.user.id]);
    const sc002RunningUrl=`${origin}/api/groups/${sc002RunningGroup}/settlement-cycle/schedule`;
    assert.equal((await expenseRequest("GET",sc002RunningUrl,undefined,jar)).body
      .current.id,sc002OldRevision,"historical schedule remains readable");
    assert.equal((await expenseRequest("PATCH",sc002RunningUrl,
      sc002Config(1,"weekly",sc002Tomorrow,"UTC"),jar)).response.status,409,
      "a change in the middle of an existing period is rejected");
    const sc002Aligned=sc002Add(sc002Date,7);
    assert.equal((await expenseRequest("PATCH",sc002RunningUrl,
      sc002Config(1,"weekly",sc002Aligned,"Asia/Ho_Chi_Minh"),jar)).response.status,409,
      "timezone change must not produce a gap/overlap between UTC instants");
    assert.equal((await expenseRequest("PATCH",sc002RunningUrl,
      sc002Config(1,"monthly",sc002Aligned,"UTC"),jar)).response.status,200);
    const sc002RunningState=(await expenseRequest("GET",sc002RunningUrl,undefined,jar)).body;
    assert.equal(sc002RunningState.current.id,sc002OldRevision);
    assert.equal(sc002RunningState.pending.frequency,"monthly");
    assert.equal(sc002RunningState.effectiveEnabled,false);

    assert.equal((await expenseRequest("POST",managersUrl,
      {memberId:otherUser.id,action:"revoke"},jar)).response.status,200);
    assert.equal((await expenseRequest("PATCH",settingsUrl,config(4,false,false),otherJar))
      .response.status,403,"revoked delegate cannot change settings");
    assert.equal((await expenseRequest("PATCH",sc002Url,
      sc002Config(2,"weekly",sc002Future),otherJar)).response.status,403,
      "revoked delegate cannot change schedule even with a valid version");

    assert.equal((await expenseRequest("POST",managersUrl,
      {memberId:thirdUser.id,action:"grant"},jar)).response.status,200);
    const transfer=await expenseRequest("POST",
      `${origin}/api/groups/${cycleGroupId}/membership/transfer`,
      {targetId:otherUser.id},jar);
    assert.equal(transfer.response.status,200,JSON.stringify(transfer.body));
    assert.equal((await expenseRequest("GET",settingsUrl,undefined,thirdJar)).body.canManage,false,
      "ownership transfer must revoke all prior delegations");
    assert.equal((await expenseRequest("PATCH",settingsUrl,config(4,false,false),jar))
      .response.status,403,"previous owner no longer has special configuration power");
    assert.equal((await expenseRequest("PATCH",sc002Url,
      sc002Config(2,"weekly",sc002Future),jar)).response.status,403,
      "old owner cannot change schedule after ownership transfer");
    assert.equal((await expenseRequest("POST",managersUrl,
      {memberId:thirdUser.id,action:"grant"},otherJar)).response.status,200,
      "new owner can explicitly grant fresh permissions");
    const thirdLeave=await expenseRequest("POST",
      `${origin}/api/groups/${cycleGroupId}/membership/leave`,{},thirdJar);
    assert.equal(thirdLeave.response.status,200,JSON.stringify(thirdLeave.body));
    assert.equal((await expenseRequest("GET",settingsUrl,undefined,thirdJar)).response.status,404);
    const invitationResponse=await expenseRequest("POST",
      `${origin}/api/groups/${cycleGroupId}/invites`,{},otherJar);
    assert.equal(invitationResponse.response.status,201);
    const thirdRejoin=await expenseRequest("POST",
      `${origin}/api/invites/accept`,{token:invitationResponse.body.token},thirdJar);
    assert.equal(thirdRejoin.response.status,200);
    assert.equal((await expenseRequest("GET",settingsUrl,undefined,thirdJar)).body.canManage,false,
      "leaving and rejoining never restores a previous delegation");
    assert.equal((await expenseRequest("PATCH",settingsUrl,config(4,false,false),thirdJar))
      .response.status,403);

    const cycleAudit=await pool.query(
      `SELECT event_type,actor_id,subject_user_id,details
       FROM group_settlement_config_events WHERE group_id=$1 ORDER BY recorded_at,id`,
      [cycleGroupId]);
    assert.ok(cycleAudit.rows.some(e=>e.event_type==="settings_changed"));
    assert.ok(cycleAudit.rows.some(e=>e.event_type==="manager_granted" &&
      e.actor_id===registered.user.id));
    assert.ok(cycleAudit.rows.some(e=>e.event_type==="manager_revoked" &&
      e.subject_user_id===thirdUser.id && e.details.reason==="ownership_transferred"));
    assert.ok(cycleAudit.rows.some(e=>e.event_type==="manager_revoked" &&
      e.subject_user_id===thirdUser.id && e.details.reason==="member_departed"));
    for(const table of ["expenses","obligations","settlements","settlement_allocations"]){
      const count=await pool.query(`SELECT count(*)::int AS n FROM ${table} WHERE group_id=$1`,
        [cycleGroupId]);
      assert.equal(count.rows[0].n,0,`${table} must not mutate during feature setup`);
    }

    // An archived group cannot be reactivated by any previous owner/delegate.
    await pool.query("UPDATE groups SET archived_at=now() WHERE id=$1",[cycleGroupId]);
    assert.equal((await expenseRequest("GET",settingsUrl,undefined,otherJar)).response.status,404);
    assert.equal((await expenseRequest("GET",sc002Url,undefined,otherJar)).response.status,404,
      "archived group schedule must not be readable");
    assert.equal((await expenseRequest("PATCH",sc002Url,
      sc002Config(2,"weekly",sc002Future),otherJar)).response.status,404,
      "archived group cannot change schedule");
    assert.equal((await expenseRequest("PATCH",settingsUrl,config(4,false,false),otherJar))
      .response.status,404,"archived group must reject settings mutations");
    assert.equal((await expenseRequest("POST",managersUrl,
      {memberId:thirdUser.id,action:"grant"},otherJar)).response.status,404,
      "archived group must reject delegated permission changes");

    // Creator-only invoice authorization: no owner, admin or payer exception.
    // B creates an invoice; C is its payer and is temporarily promoted to admin.
    const memberCreatedDraft = {
      ...draft, title: "Member-created receipt", payerId: thirdUser.id,
      items: [{ name: "Covered by admin", quantity: 1, unitPriceMinor: "10000",
        participants: [thirdUser.id] }],
    };
    const memberCreated = await expenseRequest("POST", endpoint, memberCreatedDraft, otherJar);
    assert.equal(memberCreated.response.status, 201,
      `member may create own invoice: ${JSON.stringify(memberCreated.body)}`);
    const creatorOnlyUrl = `${endpoint}/${memberCreated.body.id}`;

    await pool.query("UPDATE group_members SET role='admin' WHERE group_id=$1 AND user_id=$2",
      [groupId, thirdUser.id]);
    for (const [label, actorJar] of [["owner", jar], ["admin and payer", thirdJar]]) {
      const attempted = await expenseRequest("PATCH", creatorOnlyUrl,
        { expectedVersion: 1, expense: {
          ...memberCreatedDraft, title: "Unauthorized modification",
          createdBy: registered.user.id, // forged data must never grant access
        } }, actorJar);
      assert.equal(attempted.response.status, 403,
        `${label} cannot edit another person's invoice`);
      assert.equal((await expenseRequest("DELETE", creatorOnlyUrl,
        { expectedVersion: 1 }, actorJar)).response.status, 403,
        `${label} cannot delete another person's invoice`);

      // View access remains available, but direct /edit URL must not expose form.
      assert.equal((await expenseRequest("GET", creatorOnlyUrl, undefined, actorJar))
        .response.status, 200, `${label} may still view group invoice`);
      const editPage = await fetch(`${origin}/groups/${groupId}/expenses/${memberCreated.body.id}/edit`, {
        headers: { cookie: cookieHeader(actorJar) },
        redirect: "manual", signal: AbortSignal.timeout(10_000),
      });
      if (editPage.status === 200) {
        const html = await editPage.text();
        assert.match(html, /NEXT_HTTP_ERROR_FALLBACK|NEXT_NOT_FOUND|404/,
          `${label} must receive not-found instead of invoice edit form`);
        assert.doesNotMatch(html, /Tên hóa đơn.*Ngày chi tiêu/s,
          `${label} must not see the edit form`);
      } else {
        assert.equal(editPage.status, 404);
      }
    }
    const untouched = await pool.query("SELECT title,version,created_by FROM expenses WHERE id=$1",
      [memberCreated.body.id]);
    assert.equal(untouched.rows[0].title, "Member-created receipt");
    assert.equal(untouched.rows[0].version, 1);
    assert.equal(untouched.rows[0].created_by, otherUser.id);
    const creatorEdit = await expenseRequest("PATCH", creatorOnlyUrl,
      { expectedVersion: 1, expense: { ...memberCreatedDraft, title: "Creator updated" } },
      otherJar);
    assert.equal(creatorEdit.response.status, 200,
      `only the creator may edit: ${JSON.stringify(creatorEdit.body)}`);
    assert.equal(creatorEdit.body.version, 2);
    assert.equal((await expenseRequest("DELETE", creatorOnlyUrl,
      { expectedVersion: 2 }, thirdJar)).response.status, 403,
      "admin cannot delete an invoice after its creator edits it");
    assert.equal((await expenseRequest("DELETE", creatorOnlyUrl,
      { expectedVersion: 2 }, otherJar)).response.status, 200,
      "creator may delete own invoice under the usual settlement rules");
    await pool.query("UPDATE group_members SET role='member' WHERE group_id=$1 AND user_id=$2",
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

    // All debts fully confirmed -> creator must explicitly close each invoice.
    const beforeClose=(await expenseRequest("GET",endpoint)).body.expenses;
    const readyReceipt=beforeClose.find(x=>x.id===receipt2.body.id);
    const readyReceipt3=beforeClose.find(x=>x.id===receipt3.body.id);
    assert.equal(readyReceipt.remainingMinor,"0");
    assert.equal(readyReceipt.pendingMinor,"0");
    assert.equal(readyReceipt.completedAt,null,"payoff does not automatically close the invoice");
    assert.equal(readyReceipt3.remainingMinor,"0");
    const readyIds=beforeClose.filter(x=>!x.completedAt &&
      x.remainingMinor==="0" && x.pendingMinor==="0").map(x=>x.id);
    assert.equal(beforeClose[0].id,readyIds[0],"ready invoices are sorted to the top");
    const closeUrl=`${endpoint}/${receipt2.body.id}/complete`;
    assert.equal((await expenseRequest("POST",closeUrl,{expectedVersion:1},new Map())).response.status,401);
    assert.equal((await expenseRequest("POST",closeUrl,{expectedVersion:1,note:"not the creator"},thirdJar))
      .response.status,403,"group OWNER may not close an invoice created by someone else");
    assert.equal((await expenseRequest("POST",closeUrl,{expectedVersion:1},otherJar))
      .response.status,403,"debtor may not close creator's invoice");
    assert.equal((await expenseRequest("POST",closeUrl,{expectedVersion:88},jar))
      .response.status,409,"closing must check optimistic version");
    const closed=await expenseRequest("POST",closeUrl,{expectedVersion:1,note:"Đã nhận đủ từ mọi người"},jar);
    assert.equal(closed.response.status,200,JSON.stringify(closed.body));
    assert.equal(closed.body.completed,true);
    assert.equal(closed.body.version,2);
    assert.equal((await expenseRequest("POST",closeUrl,{expectedVersion:1},jar))
      .response.status,409,"closing twice is forbidden");
    const completedDetail=await expenseRequest("GET",`${endpoint}/${receipt2.body.id}`,undefined,jar);
    assert.equal(completedDetail.response.status,200);
    assert.ok(completedDetail.body.expense.completedAt);
    assert.equal(completedDetail.body.expense.completedBy,registered.user.id);
    assert.equal(completedDetail.body.expense.completionNote,"Đã nhận đủ từ mọi người");
    assert.equal((await expenseRequest("PATCH",`${endpoint}/${receipt2.body.id}`,{
      expectedVersion:2,expense:debtDraft,
    },jar)).response.status,409,"completed invoice cannot be edited");
    assert.equal((await expenseRequest("DELETE",`${endpoint}/${receipt2.body.id}`,{
      expectedVersion:2,
    },jar)).response.status,409,"completed invoice cannot be deleted");
    const closedEvent=await pool.query(
      "SELECT actor_id,expense_version AS version,note FROM expense_completion_events WHERE expense_id=$1",
      [receipt2.body.id],
    );
    assert.equal(closedEvent.rows.length,1);
    assert.equal(closedEvent.rows[0].actor_id,registered.user.id);
    assert.equal(closedEvent.rows[0].note,"Đã nhận đủ từ mọi người");
    const afterClose=(await expenseRequest("GET",endpoint)).body.expenses;
    assert.ok(afterClose.find(x=>x.id===receipt2.body.id).completedAt);
    assert.equal(afterClose.find(x=>x.id===receipt3.body.id).completedAt,null,
      "finalizing one invoice must not auto-complete unrelated invoices");
    assert.equal((await expenseRequest("GET",debtEndpoint)).body.debts.find(
      x=>x.expenseId===receipt2.body.id).outstandingMinor,"0",
      "completion does not remove or rewrite settled debts");

    // Multiple debtors in the SAME invoice: creator must wait for EVERY person.
    const sharedDraft={...debtDraft,title:"Finalized group dinner",items:[
      {name:"B portion",quantity:1,unitPriceMinor:"12000",participants:[otherUser.id]},
      {name:"C portion",quantity:1,unitPriceMinor:"14000",participants:[thirdUser.id]},
    ]};
    const shared=await expenseRequest("POST",endpoint,sharedDraft);
    assert.equal(shared.response.status,201,JSON.stringify(shared.body));
    const sharedCloseUrl=`${endpoint}/${shared.body.id}/complete`;
    const sharedDebts=(await expenseRequest("GET",debtEndpoint)).body.debts
      .filter(x=>x.expenseId===shared.body.id);
    assert.equal(sharedDebts.length,2);
    assert.equal((await expenseRequest("POST",sharedCloseUrl,{expectedVersion:1},jar))
      .response.status,409,"invoice with two unpaid people cannot be finalized");
    for(const [index,debtor] of [otherUser,thirdUser].entries()){
      const actorJar=index===0?otherJar:thirdJar;
      const owed=sharedDebts.find(x=>x.debtorId===debtor.id);
      const request=await expenseRequest("POST",settlementUrl,{
        requestKey:randomUUID(),
        allocations:[{obligationId:owed.id,amountMinor:owed.amountMinor}],
        note:"paid share "+index,
      },actorJar);
      assert.equal(request.response.status,201,JSON.stringify(request.body));
      assert.equal((await expenseRequest("POST",sharedCloseUrl,{expectedVersion:1},jar))
        .response.status,409,"pending or incomplete repayment must block invoice finalization");
      const approve=await expenseRequest("PATCH",`${settlementUrl}/${request.body.id}`,{
        action:"confirm",note:"receipt confirmed",
      },jar);
      assert.equal(approve.response.status,200);
      if(index===0)assert.equal((await expenseRequest("POST",sharedCloseUrl,{expectedVersion:1},jar))
        .response.status,409,"first debtor paid, second debtor still owes money");
    }
    const readyShared=(await expenseRequest("GET",`${endpoint}/${shared.body.id}`)).body.expense;
    assert.equal(readyShared.remainingMinor,"0");
    assert.equal(readyShared.confirmedMinor,"26000");
    assert.equal(readyShared.pendingMinor,"0");
    assert.equal(readyShared.completedAt,null);
    assert.equal((await expenseRequest("POST",sharedCloseUrl,{expectedVersion:1},thirdJar))
      .response.status,403,"group owner is NOT permitted to finalize invoice they didn't create");
    assert.equal((await expenseRequest("POST",sharedCloseUrl,{
      expectedVersion:1,note:"B và C đã tất toán",
    },jar)).response.status,200);
    assert.ok((await expenseRequest("GET",`${endpoint}/${shared.body.id}`)).body.expense.completedAt);

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

    // Monthly fixed expenses are independent of ordinary group test balances.
    const recurringGroupId=randomUUID();
    await pool.query("INSERT INTO groups(id,owner_id,name) VALUES($1,$2,$3)",
      [recurringGroupId,registered.user.id,"Monthly bills test"]);
    await pool.query("INSERT INTO group_members(group_id,user_id,role) VALUES($1,$2,'owner')",
      [recurringGroupId,registered.user.id]);
    await pool.query("INSERT INTO group_members(group_id,user_id,role) VALUES($1,$2,'member')",
      [recurringGroupId,otherUser.id]);
    const dateParts=new Intl.DateTimeFormat("en-US",{
      timeZone:"Asia/Ho_Chi_Minh",year:"numeric",month:"2-digit",day:"2-digit",
    }).formatToParts(new Date());
    const dateValue=kind=>dateParts.find(p=>p.type===kind).value;
    const monthlyToday=`${dateValue("year")}-${dateValue("month")}-${dateValue("day")}`;
    const monthlyApi=`${origin}/api/groups/${recurringGroupId}/recurring`;
    const monthlyDraft={
      title:"Tiền internet hàng tháng",notes:"Cố định 12.000đ",
      payerId:registered.user.id,startsOn:monthlyToday,
      dayOfMonth:Number(dateValue("day")),
      items:[{name:"Cước mạng",quantity:1,unitPriceMinor:"12000",
        participants:[otherUser.id]}],
    };
    assert.equal((await expenseRequest("POST",monthlyApi,monthlyDraft,new Map()))
      .response.status,401,"recurring rules require login");
    assert.equal((await expenseRequest("POST",monthlyApi,monthlyDraft,thirdJar))
      .response.status,404,"other group member cannot create recurring bills");
    const recurringCreated=await expenseRequest("POST",monthlyApi,monthlyDraft,jar);
    assert.equal(recurringCreated.response.status,201,JSON.stringify(recurringCreated.body));
    const monthlyId=recurringCreated.body.id;
    const monthlyDetailUrl=`${monthlyApi}/${monthlyId}`;
    const generatedUrl=monthlyDetailUrl+"/generate";
    const monthlyRows=(await expenseRequest("GET",monthlyApi,undefined,jar)).body.rules;
    assert.equal(monthlyRows.length,1);
    assert.equal(monthlyRows[0].totalMinor,"12000");
    assert.equal(monthlyRows[0].createdBy,registered.user.id);
    assert.equal((await expenseRequest("POST",generatedUrl,{},otherJar))
      .response.status,403,"only schedule creator may generate due bills");
    const [firstRun,concurrentRun]=await Promise.all([
      expenseRequest("POST",generatedUrl,{},jar),
      expenseRequest("POST",generatedUrl,{},jar),
    ]);
    assert.equal(firstRun.response.status,200,JSON.stringify(firstRun.body));
    assert.equal(concurrentRun.response.status,200,JSON.stringify(concurrentRun.body));
    assert.equal(firstRun.body.generated+concurrentRun.body.generated,1,
      "two concurrent generation requests must create only one invoice");
    const secondRun=await expenseRequest("POST",generatedUrl,{},jar);
    assert.equal(secondRun.response.status,200);
    assert.equal(secondRun.body.generated,0,"repeated cron/manual trigger is idempotent");
    const occurrences=await pool.query(
      `SELECT o.period::text,o.scheduled_on::text,e.id,e.created_by,e.total_minor::text
       FROM recurring_expense_occurrences o JOIN expenses e ON e.id=o.expense_id
       WHERE o.rule_id=$1`,[monthlyId]);
    assert.equal(occurrences.rowCount,1);
    const monthlyInvoiceId=occurrences.rows[0].id;
    assert.equal(occurrences.rows[0].scheduled_on,monthlyToday);
    assert.equal(occurrences.rows[0].created_by,registered.user.id);
    assert.equal(occurrences.rows[0].total_minor,"12000");
    const monthlyObligation=await pool.query(
      "SELECT debtor_id,creditor_id,amount_minor::text FROM obligations WHERE expense_id=$1 AND voided_at IS NULL",
      [monthlyInvoiceId]);
    assert.equal(monthlyObligation.rowCount,1);
    assert.equal(monthlyObligation.rows[0].debtor_id,otherUser.id);
    assert.equal(monthlyObligation.rows[0].creditor_id,registered.user.id);
    assert.equal(monthlyObligation.rows[0].amount_minor,"12000");

    const adjusted={...monthlyDraft,items:[{...monthlyDraft.items[0],unitPriceMinor:"18000"}]};
    assert.equal((await expenseRequest("PATCH",monthlyDetailUrl,
      {expectedVersion:1,rule:adjusted},otherJar)).response.status,403,
      "non-creator cannot edit monthly rule");
    const changed=await expenseRequest("PATCH",monthlyDetailUrl,
      {expectedVersion:1,rule:adjusted},jar);
    assert.equal(changed.response.status,200,JSON.stringify(changed.body));
    assert.equal(changed.body.version,2);
    const originalInvoice=await pool.query(
      "SELECT total_minor::text FROM expenses WHERE id=$1",[monthlyInvoiceId]);
    assert.equal(originalInvoice.rows[0].total_minor,"12000",
      "editing template must never rewrite an already generated invoice");
    assert.equal((await expenseRequest("POST",monthlyDetailUrl,
      {expectedVersion:2,action:"pause"},otherJar)).response.status,403);
    const pause=await expenseRequest("POST",monthlyDetailUrl,
      {expectedVersion:2,action:"pause"},jar);
    assert.equal(pause.response.status,200);
    assert.equal((await expenseRequest("POST",generatedUrl,{},jar))
      .response.status,409,"paused schedule cannot create bills");
    const resume=await expenseRequest("POST",monthlyDetailUrl,
      {expectedVersion:3,action:"resume"},jar);
    assert.equal(resume.response.status,200);
    assert.equal((await expenseRequest("POST",generatedUrl,{},jar)).body.generated,0,
      "resuming must not duplicate the current month");
    assert.equal((await pool.query(
      "SELECT count(*)::int AS count FROM recurring_expense_occurrences WHERE rule_id=$1",
      [monthlyId])).rows[0].count,1);

    const futureDay=Number(dateValue("day"))<31
      ? Number(dateValue("day"))+1:1;
    const futureRule=await expenseRequest("POST",monthlyApi,
      {...monthlyDraft,title:"Kỳ chưa đến hạn",dayOfMonth:futureDay},jar);
    assert.equal(futureRule.response.status,201);
    assert.equal((await expenseRequest("POST",
      `${monthlyApi}/${futureRule.body.id}/generate`,{},jar)).body.generated,0,
      "a future due date must not generate a bill early");

    // SC-003 metadata-only lifecycle: no financial snapshot or settlement writes.
    const sc003Group=randomUUID(),sc003ManualRevision=randomUUID();
    await pool.query("INSERT INTO groups(id,owner_id,name) VALUES($1,$2,'SC003 manual cycle')",
      [sc003Group,registered.user.id]);
    await pool.query("INSERT INTO group_members(group_id,user_id,role) VALUES($1,$2,'owner')",
      [sc003Group,registered.user.id]);
    await pool.query("INSERT INTO group_members(group_id,user_id,role) VALUES($1,$2,'member')",
      [sc003Group,otherUser.id]);
    await pool.query("INSERT INTO group_members(group_id,user_id,role) VALUES($1,$2,'admin')",
      [sc003Group,thirdUser.id]);
    const sc003Today=new Date().toISOString().slice(0,10);
    const sc003Date=days=>new Date(Date.parse(sc003Today+"T00:00:00Z")+
      days*86400000).toISOString().slice(0,10);
    const sc003Api=`${origin}/api/groups/${sc003Group}/settlement-cycle/cycles`;
    const sc003SettingUrl=`${origin}/api/groups/${sc003Group}/settlement-cycle/settings`;
    const sc003ScheduleUrl=`${origin}/api/groups/${sc003Group}/settlement-cycle/schedule`;
    const sc003Init=(key,start=sc003Date(-3),end=sc003Date(-1))=>({
      expectedScheduleVersion:1,requestKey:key,startDate:start,endDate:end,
    });
    assert.equal((await expenseRequest("GET",sc003Api,undefined,new Map())).response.status,401);
    assert.equal((await expenseRequest("GET",sc003Api,undefined,jar)).body.cycles.length,0);
    assert.equal((await expenseRequest("GET",sc003Api,undefined,thirdJar)).response.status,200);
    await pool.query(
      "INSERT INTO group_settlement_schedule_heads(group_id,updated_by) VALUES($1,$2)",
      [sc003Group,registered.user.id]);
    await pool.query(`INSERT INTO group_settlement_schedule_revisions
      (id,group_id,version,frequency,time_zone,anchor_date,effective_at,created_by)
      VALUES($1,$2,1,'manual','UTC',$3,$4,$5)`,
      [sc003ManualRevision,sc003Group,sc003Date(-6),sc003Date(-6)+"T00:00:00Z",
        registered.user.id]);
    assert.equal((await expenseRequest("POST",sc003Api,sc003Init(randomUUID()),jar))
      .response.status,409,"default OFF cannot create a manual cycle");
    assert.equal((await expenseRequest("PATCH",sc003SettingUrl,
      config(0,true,false),jar)).response.status,200);
    assert.equal((await expenseRequest("POST",sc003Api,sc003Init(randomUUID()),jar))
      .response.status,409,
      "manual periods before the opt-in instant cannot be imported retroactively");
    // SQL-only fixture: simulate a group that explicitly opted in last week.
    // Never backdate production settings, and never rewrite financial history.
    await pool.query(`UPDATE group_settlement_config_events
      SET recorded_at=$2::timestamptz
      WHERE group_id=$1 AND event_type='settings_changed'`,
      [sc003Group,sc003Date(-7)+"T00:00:00Z"]);
    assert.equal((await expenseRequest("POST",sc003Api,sc003Init(randomUUID()),thirdJar))
      .response.status,403,"group admin has no cycle-manager power");
    const sc003FirstKey=randomUUID();
    const sc003First=await expenseRequest("POST",sc003Api,sc003Init(sc003FirstKey),jar);
    assert.equal(sc003First.response.status,201,JSON.stringify(sc003First.body));
    assert.equal(sc003First.body.cycle.state,"open");
    assert.equal(sc003First.body.cycle.version,1);
    const sc003FirstId=sc003First.body.cycle.id;
    assert.equal((await expenseRequest("POST",sc003Api,sc003Init(sc003FirstKey),jar))
      .body.cycle.id,sc003FirstId,"lost response retry must preserve cycle ID");
    assert.equal((await expenseRequest("POST",sc003Api,sc003Init(sc003FirstKey,
      sc003Date(-3),sc003Today),jar)).response.status,409,
      "a reused idempotency key cannot represent another period");
    assert.equal((await expenseRequest("POST",sc003Api,sc003Init(randomUUID(),
      sc003Date(-2),sc003Today),jar)).response.status,409,
      "overlapping manual range cannot be inserted");
    assert.equal((await expenseRequest("POST",sc003Api,{
      ...sc003Init(randomUUID()),unexpected:true,
    },jar)).response.status,400);
    assert.equal((await expenseRequest("POST",sc003Api,sc003Init(randomUUID(),
      "2026-02-30",sc003Today),jar)).response.status,400);

    const sc003ReviewUrl=`${sc003Api}/${sc003FirstId}/review`;
    assert.equal((await expenseRequest("POST",sc003ReviewUrl,
      {expectedVersion:1},thirdJar)).response.status,403);
    const sc003Reviewed=await expenseRequest("POST",sc003ReviewUrl,
      {expectedVersion:1},jar);
    assert.equal(sc003Reviewed.response.status,200,JSON.stringify(sc003Reviewed.body));
    assert.equal(sc003Reviewed.body.cycle.state,"review");
    assert.equal(sc003Reviewed.body.cycle.version,2);
    assert.equal((await expenseRequest("POST",sc003ReviewUrl,
      {expectedVersion:1},jar)).response.status,409);
    assert.equal((await expenseRequest("POST",sc003ReviewUrl,
      {expectedVersion:2},jar)).response.status,409,
      "review is terminal for SC-003; locking requires SC-004");

    const sc003GrantUrl=`${origin}/api/groups/${sc003Group}/settlement-cycle/managers`;
    assert.equal((await expenseRequest("POST",sc003GrantUrl,
      {memberId:otherUser.id,action:"grant"},jar)).response.status,200);
    const sc003OverlapStart=sc003Date(-1),sc003OverlapEnd=sc003Date(2);
    const sc003Race=await Promise.all([
      expenseRequest("POST",sc003Api,sc003Init(randomUUID(),
        sc003OverlapStart,sc003OverlapEnd),jar),
      expenseRequest("POST",sc003Api,sc003Init(randomUUID(),
        sc003OverlapStart,sc003OverlapEnd),otherJar),
    ]);
    assert.deepEqual(sc003Race.map(x=>x.response.status).sort(),[201,409],
      "simultaneous owner/delegate creation must produce one cycle");
    const sc003Pending=sc003Race.find(x=>x.response.status===201).body.cycle;
    assert.equal((await expenseRequest("POST",
      `${sc003Api}/${sc003Pending.id}/review`,{expectedVersion:1},jar))
      .response.status,409,"future end cannot be reviewed early");
    assert.equal((await expenseRequest("PATCH",sc003ScheduleUrl,{
      expectedVersion:1,frequency:"weekly",timeZone:"UTC",
      anchorDate:sc003Date(1),
    },jar)).response.status,409,
      "schedule cutover cannot split an existing manual cycle");
    const sc003Events=await pool.query(
      `SELECT event_type,initiator,actor_id FROM group_settlement_cycle_events
       WHERE group_id=$1 ORDER BY recorded_at,id`,[sc003Group]);
    assert.equal(sc003Events.rows.length,3,"exactly two creates and one review event");
    assert.equal(sc003Events.rows.filter(e=>e.event_type==="created").length,2);
    assert.equal(sc003Events.rows.filter(e=>e.event_type==="review_requested").length,1);
    assert.ok(sc003Events.rows.every(e=>e.actor_id));
    for(const table of ["expenses","obligations","settlements","settlement_allocations"]){
      assert.equal((await pool.query(
        `SELECT count(*)::int AS n FROM ${table} WHERE group_id=$1`,
        [sc003Group])).rows[0].n,0,"metadata-only lifecycle never writes money");
    }

    // Catch-up: an existing opted-in group has five weeks worth of periods.
    // The historical setting event is a disposable SQL fixture, NEVER a
    // backdated production mutation.
    const sc003AutomaticGroup=randomUUID(),sc003AutoRevision=randomUUID();
    await pool.query("INSERT INTO groups(id,owner_id,name) VALUES($1,$2,'SC003 automatic')",
      [sc003AutomaticGroup,registered.user.id]);
    await pool.query("INSERT INTO group_members(group_id,user_id,role) VALUES($1,$2,'owner')",
      [sc003AutomaticGroup,registered.user.id]);
    const sc003AutoSettings=`${origin}/api/groups/${sc003AutomaticGroup}/settlement-cycle/settings`;
    const sc003AutoApi=`${origin}/api/groups/${sc003AutomaticGroup}/settlement-cycle/cycles`;
    assert.equal((await expenseRequest("PATCH",sc003AutoSettings,
      config(0,true,false),jar)).response.status,200);
    await pool.query(`UPDATE group_settlement_config_events
       SET recorded_at=$2::timestamptz
       WHERE group_id=$1 AND event_type='settings_changed'`,
      [sc003AutomaticGroup,sc003Date(-29)+"T00:00:00Z"]);
    await pool.query(
      "INSERT INTO group_settlement_schedule_heads(group_id,updated_by) VALUES($1,$2)",
      [sc003AutomaticGroup,registered.user.id]);
    await pool.query(`INSERT INTO group_settlement_schedule_revisions
      (id,group_id,version,frequency,time_zone,anchor_date,effective_at,created_by)
      VALUES($1,$2,1,'weekly','UTC',$3,$4,$5)`,
      [sc003AutoRevision,sc003AutomaticGroup,sc003Date(-28),
        sc003Date(-28)+"T00:00:00Z",registered.user.id]);
    const sc003Refresh=`${sc003AutoApi}/refresh`;
    assert.equal((await expenseRequest("POST",sc003Refresh,{},thirdJar))
      .response.status,404,"non-member cannot manually refresh group");
    const sc003FirstRefresh=await expenseRequest("POST",sc003Refresh,{},jar);
    assert.equal(sc003FirstRefresh.response.status,200,JSON.stringify(sc003FirstRefresh.body));
    assert.equal(sc003FirstRefresh.body.created,5);
    assert.equal(sc003FirstRefresh.body.reviewed,4);
    const sc003SecondRefresh=await expenseRequest("POST",sc003Refresh,{},jar);
    assert.equal(sc003SecondRefresh.response.status,200);
    assert.equal(sc003SecondRefresh.body.created,0);
    assert.equal(sc003SecondRefresh.body.reviewed,0);
    const sc003AutoRows=(await expenseRequest("GET",sc003AutoApi,undefined,jar)).body.cycles;
    assert.equal(sc003AutoRows.length,5);
    assert.equal(sc003AutoRows.filter(x=>x.state==="review").length,4);
    assert.equal(sc003AutoRows.filter(x=>x.state==="open").length,1);
    assert.equal(sc003AutoRows[0].endAt,sc003Date(7)+"T00:00:00.000Z");
    assert.equal((await expenseRequest("PATCH",sc003AutoSettings,
      config(1,false,false),jar)).response.status,200);
    assert.equal((await expenseRequest("POST",sc003Refresh,{},jar))
      .body.disabled,true,"disabled groups cannot generate cycles");
    assert.equal((await pool.query(
      "SELECT count(*)::int AS n FROM group_settlement_cycles WHERE group_id=$1",
      [sc003AutomaticGroup])).rows[0].n,5);

    // Multi-revision cutover: old weekly stops EXACTLY where new
    // biweekly starts. No gap, overlap or duplicated historical period.
    const sc003RevisionsGroup=randomUUID();
    const sc003OldRev=randomUUID(),sc003NewRev=randomUUID();
    await pool.query("INSERT INTO groups(id,owner_id,name) VALUES($1,$2,'SC003 revision boundary')",
      [sc003RevisionsGroup,registered.user.id]);
    await pool.query("INSERT INTO group_members(group_id,user_id,role) VALUES($1,$2,'owner')",
      [sc003RevisionsGroup,registered.user.id]);
    const revSettings=`${origin}/api/groups/${sc003RevisionsGroup}/settlement-cycle/settings`;
    const revApi=`${origin}/api/groups/${sc003RevisionsGroup}/settlement-cycle/cycles`;
    assert.equal((await expenseRequest("PATCH",revSettings,
      config(0,true,false),jar)).response.status,200);
    await pool.query(`UPDATE group_settlement_config_events SET recorded_at=$2::timestamptz
      WHERE group_id=$1 AND event_type='settings_changed'`,
      [sc003RevisionsGroup,sc003Date(-43)+"T00:00:00Z"]);
    await pool.query(`INSERT INTO group_settlement_schedule_heads
      (group_id,version,updated_by) VALUES($1,2,$2)`,
      [sc003RevisionsGroup,registered.user.id]);
    await pool.query(`INSERT INTO group_settlement_schedule_revisions
      (id,group_id,version,frequency,time_zone,anchor_date,effective_at,created_by)
      VALUES($1,$2,1,'weekly','UTC',$3,$4,$5)`,
      [sc003OldRev,sc003RevisionsGroup,sc003Date(-42),
        sc003Date(-42)+"T00:00:00Z",registered.user.id]);
    await pool.query(`INSERT INTO group_settlement_schedule_revisions
      (id,group_id,version,frequency,time_zone,anchor_date,effective_at,created_by)
      VALUES($1,$2,2,'biweekly','UTC',$3,$4,$5)`,
      [sc003NewRev,sc003RevisionsGroup,sc003Date(-14),
        sc003Date(-14)+"T00:00:00Z",registered.user.id]);
    const revRefresh=await expenseRequest("POST",revApi+"/refresh",{},jar);
    assert.equal(revRefresh.response.status,200,JSON.stringify(revRefresh.body));
    assert.equal(revRefresh.body.created,6);
    assert.equal(revRefresh.body.reviewed,5);
    const revRows=(await expenseRequest("GET",revApi,undefined,jar)).body.cycles
      .sort((a,b)=>a.startAt.localeCompare(b.startAt));
    assert.equal(revRows.length,6);
    for(let i=1;i<revRows.length;i++)
      assert.equal(revRows[i-1].endAt,revRows[i].startAt,
        "revision cutover must preserve exact touching UTC boundaries");
    assert.equal(revRows.filter(x=>x.scheduleRevisionId===sc003OldRev).length,4);
    assert.equal(revRows.filter(x=>x.scheduleRevisionId===sc003NewRev).length,2);
    assert.equal((await expenseRequest("POST",revApi+"/refresh",{},jar)).body.created,0);

    // Opt-in AFTER past periods: the service must NEVER backfill those
    // historical periods into a newly enabled group's metadata.
    const sc003NewOptGroup=randomUUID(),sc003NewOptRev=randomUUID();
    await pool.query("INSERT INTO groups(id,owner_id,name) VALUES($1,$2,'SC003 late opt in')",
      [sc003NewOptGroup,registered.user.id]);
    await pool.query("INSERT INTO group_members(group_id,user_id,role) VALUES($1,$2,'owner')",
      [sc003NewOptGroup,registered.user.id]);
    await pool.query(`INSERT INTO group_settlement_schedule_heads
      (group_id,updated_by) VALUES($1,$2)`,
      [sc003NewOptGroup,registered.user.id]);
    await pool.query(`INSERT INTO group_settlement_schedule_revisions
      (id,group_id,version,frequency,time_zone,anchor_date,effective_at,created_by)
      VALUES($1,$2,1,'weekly','UTC',$3,$4,$5)`,
      [sc003NewOptRev,sc003NewOptGroup,sc003Date(-21),
        sc003Date(-21)+"T00:00:00Z",registered.user.id]);
    assert.equal((await expenseRequest("PATCH",
      `${origin}/api/groups/${sc003NewOptGroup}/settlement-cycle/settings`,
      config(0,true,false),jar)).response.status,200);
    const freshRefresh=await expenseRequest("POST",
      `${origin}/api/groups/${sc003NewOptGroup}/settlement-cycle/cycles/refresh`,{},jar);
    assert.equal(freshRefresh.response.status,200);
    assert.equal(freshRefresh.body.created,0,
      "late opt-in must not create retroactive weekly cycles");
    assert.equal((await pool.query(
      "SELECT count(*)::int AS n FROM group_settlement_cycles WHERE group_id=$1",
      [sc003NewOptGroup])).rows[0].n,0);

    const sc003CronSecret=process.env.CRON_SECRET;
    if(sc003CronSecret){
      // Existing Cron endpoint has an independent bearer secret, not session auth.
      const cron=await fetch(`${origin}/api/internal/push-drain`,{
        headers:{authorization:`Bearer ${sc003CronSecret}`},
        signal:AbortSignal.timeout(20_000),
      });
      assert.equal(cron.status,200,"valid CI-only Cron bearer must work");
      const data=await cron.json();
      assert.equal(data.cycles.metadataOnly,true);
      assert.equal(data.cycles.errors,0);
    }
    assert.equal((await expenseRequest("GET",sc003AutoApi,undefined,new Map()))
      .response.status,401);

    // SC-004: full HTTP -> Postgres financial snapshot. The SC-003 manual
    // cycle is in REVIEW and opted-in but the actual money engine remains OFF.
    const sc004Url=`${sc003Api}/${sc003FirstId}/snapshot`;
    const sc004ExpensesApi=`${origin}/api/groups/${sc003Group}/expenses`;
    const sc004PaymentsApi=`${origin}/api/groups/${sc003Group}/settlements`;
    assert.equal((await expenseRequest("GET",sc004Url,undefined,new Map()))
      .response.status,401);
    assert.equal((await expenseRequest("GET",sc004Url,undefined,thirdJar))
      .response.status,200,"a member may inspect, but not lock");
    assert.equal((await expenseRequest("POST",sc004Url,{
      expectedVersion:2,requestKey:randomUUID(),expectedFingerprint:"a".repeat(64),
    },thirdJar)).response.status,403,"admin without delegation cannot lock");

    const sc004BillDraft={
      title:"SC004 confirmed and pending",notes:"isolated HTTP fixture",
      occurredOn:sc003Date(-2),payerId:registered.user.id,
      items:[{name:"Shared weekly meal",quantity:1,
        unitPriceMinor:"100000",participants:[otherUser.id]}],
    };
    const sc004Made=await expenseRequest("POST",sc004ExpensesApi,sc004BillDraft,jar);
    assert.equal(sc004Made.response.status,201,JSON.stringify(sc004Made.body));
    const sc004Invoice=sc004Made.body.id;
    const sc004Obligation=(await pool.query(
      "SELECT id,amount_minor::text FROM obligations WHERE expense_id=$1 AND voided_at IS NULL",
      [sc004Invoice])).rows[0];
    assert.equal(sc004Obligation.amount_minor,"100000");

    // A bill exactly at the exclusive end is NOT part of this cycle.
    const sc004Boundary=await expenseRequest("POST",sc004ExpensesApi,{
      ...sc004BillDraft,occurredOn:sc003Date(-1),
      title:"SC004 next period boundary",
      items:[{...sc004BillDraft.items[0],unitPriceMinor:"1000"}],
    },jar);
    assert.equal(sc004Boundary.response.status,201);
    // Deleted invoices must not enter the canonical snapshot.
    const sc004Deleted=await expenseRequest("POST",sc004ExpensesApi,{
      ...sc004BillDraft,title:"SC004 void before snapshot",
      items:[{...sc004BillDraft.items[0],unitPriceMinor:"1000"}],
    },jar);
    assert.equal(sc004Deleted.response.status,201);
    assert.equal((await expenseRequest("DELETE",
      `${sc004ExpensesApi}/${sc004Deleted.body.id}`,{expectedVersion:1},jar))
      .response.status,200);

    // 550 additional obligations: proves the canonical SQL ignores the
    // 100-invoice and 500-obligation caps of the existing UI lists.
    await pool.query(`INSERT INTO expenses
      (id,group_id,payer_id,created_by,title,occurred_on,total_minor)
      SELECT gen_random_uuid(),$1,$2,$2,
        'SC004 Bulk '||g::text,$3::date,1000
      FROM generate_series(1,550) AS g`,
      [sc003Group,registered.user.id,sc003Date(-2)]);
    await pool.query(`INSERT INTO expense_items
      (id,expense_id,group_id,position,name,quantity,unit_price_minor,amount_minor)
      SELECT gen_random_uuid(),id,group_id,0,'Bulk item',1,1000,1000
      FROM expenses WHERE group_id=$1 AND title LIKE 'SC004 Bulk %'`,
      [sc003Group]);
    await pool.query(`INSERT INTO expense_item_shares(item_id,group_id,user_id,amount_minor)
      SELECT i.id,i.group_id,$2,1000 FROM expense_items i
      JOIN expenses e ON e.id=i.expense_id
      WHERE e.group_id=$1 AND e.title LIKE 'SC004 Bulk %'`,
      [sc003Group,otherUser.id]);
    await pool.query(`INSERT INTO obligations
      (id,group_id,expense_id,expense_version,debtor_id,creditor_id,amount_minor)
      SELECT gen_random_uuid(),group_id,id,1,$2,$3,1000
      FROM expenses WHERE group_id=$1 AND title LIKE 'SC004 Bulk %'`,
      [sc003Group,otherUser.id,registered.user.id]);
    await pool.query(`INSERT INTO obligation_sources
      (id,obligation_id,expense_item_id,item_name,amount_minor)
      SELECT gen_random_uuid(),o.id,i.id,'Bulk item',1000
      FROM obligations o JOIN expense_items i ON i.expense_id=o.expense_id
      JOIN expenses e ON e.id=o.expense_id
      WHERE o.group_id=$1 AND e.title LIKE 'SC004 Bulk %'`,[sc003Group]);

    const sc004Cash1=await expenseRequest("POST",sc004PaymentsApi,{
      requestKey:randomUUID(),
      allocations:[{obligationId:sc004Obligation.id,amountMinor:"30000"}],
    },otherJar);
    assert.equal(sc004Cash1.response.status,201,JSON.stringify(sc004Cash1.body));
    assert.equal((await expenseRequest("PATCH",
      `${sc004PaymentsApi}/${sc004Cash1.body.id}`,{action:"confirm"},jar))
      .response.status,200);
    const sc004Cash2=await expenseRequest("POST",sc004PaymentsApi,{
      requestKey:randomUUID(),
      allocations:[{obligationId:sc004Obligation.id,amountMinor:"20000"}],
    },otherJar);
    assert.equal(sc004Cash2.response.status,201,JSON.stringify(sc004Cash2.body));

    const sc004Preview1=await expenseRequest("GET",sc004Url,undefined,jar);
    assert.equal(sc004Preview1.response.status,200);
    const sc004Before=sc004Preview1.body.snapshot;
    assert.equal(sc004Before.state,"review");
    assert.equal(sc004Before.previewOnly,true);
    assert.deepEqual([
      sc004Before.expenseCount,sc004Before.obligationCount,
      sc004Before.originalMinor,sc004Before.confirmedCashMinor,
      sc004Before.pendingCashMinor,sc004Before.outstandingMinor,
      sc004Before.availableMinor,
    ],[551,551,"650000","30000","20000","620000","600000"]);
    assert.match(sc004Before.fingerprint,/^[0-9a-f]{64}$/);
    assert.equal(sc004Preview1.body.financialEngineEnabled,false);
    assert.equal((await expenseRequest("POST",sc004Url,{
      expectedVersion:2,requestKey:randomUUID(),
      expectedFingerprint:"x".repeat(64),
    },jar)).response.status,400,"malformed fingerprint fails validation");
    assert.equal((await expenseRequest("POST",sc004Url,{
      expectedVersion:2,requestKey:randomUUID(),
    },jar)).response.status,400,"all lock keys required");

    // Cash confirmation invalidates the manager's old preview.
    assert.equal((await expenseRequest("PATCH",
      `${sc004PaymentsApi}/${sc004Cash2.body.id}`,{action:"confirm"},jar))
      .response.status,200);
    assert.equal((await expenseRequest("POST",sc004Url,{
      expectedVersion:2,requestKey:randomUUID(),
      expectedFingerprint:sc004Before.fingerprint,
    },jar)).response.status,409,
    "manager cannot lock data that changed after explicit preview");

    const sc004Cash3=await expenseRequest("POST",sc004PaymentsApi,{
      requestKey:randomUUID(),
      allocations:[{obligationId:sc004Obligation.id,amountMinor:"10000"}],
    },otherJar);
    assert.equal(sc004Cash3.response.status,201);
    const sc004Preview2=await expenseRequest("GET",sc004Url,undefined,otherJar);
    assert.equal(sc004Preview2.response.status,200);
    const sc004Reviewed=sc004Preview2.body.snapshot;
    assert.deepEqual([
      sc004Reviewed.originalMinor,sc004Reviewed.confirmedCashMinor,
      sc004Reviewed.pendingCashMinor,sc004Reviewed.outstandingMinor,
      sc004Reviewed.availableMinor,
    ],["650000","50000","10000","600000","590000"]);

    // Two authorized writers can try to seal the same version; group row
    // lock + version + one manifest guarantee a single winner.
    const sc004KeyA=randomUUID(),sc004KeyB=randomUUID();
    const requests=[
      {jar,requestKey:sc004KeyA,actor:registered.user.id},
      {jar:otherJar,requestKey:sc004KeyB,actor:otherUser.id},
    ];
    const sc004Race=await Promise.all(requests.map(x=>expenseRequest(
      "POST",sc004Url,{
        expectedVersion:2,requestKey:x.requestKey,
        expectedFingerprint:sc004Reviewed.fingerprint,
      },x.jar)));
    assert.deepEqual(sc004Race.map(x=>x.response.status).sort(),[200,409],
      "concurrent snapshot locks commit exactly once");
    const sc004Winner=sc004Race.findIndex(x=>x.response.status===200);
    const stored=sc004Race[sc004Winner].body.snapshot;
    assert.equal(stored.state,"locked");
    assert.equal(stored.fingerprint,sc004Reviewed.fingerprint);
    const duplicate=await expenseRequest("POST",sc004Url,{
      expectedVersion:2,requestKey:requests[sc004Winner].requestKey,
      expectedFingerprint:sc004Reviewed.fingerprint,
    },requests[sc004Winner].jar);
    assert.equal(duplicate.response.status,200,
      "lost HTTP response retry returns the same sealed snapshot");
    assert.equal(duplicate.body.snapshot.cycleId,sc003FirstId);
    assert.equal((await expenseRequest("POST",sc004Url,{
      expectedVersion:2,requestKey:randomUUID(),
      expectedFingerprint:sc004Reviewed.fingerprint,
    },jar)).response.status,409,"a second key cannot relock a frozen period");
    const sc004Sealed=(await expenseRequest("GET",sc004Url,undefined,thirdJar)).body;
    assert.equal(sc004Sealed.snapshot.state,"locked");
    assert.equal(sc004Sealed.snapshot.obligationCount,551);
    assert.equal(sc004Sealed.snapshot.pendingCashMinor,"10000");
    assert.equal(sc004Sealed.lateExpenseCount,0);

    // Late invoice belongs to the old date range but NOT to the frozen
    // snapshot. It must be reported as an adjustment candidate.
    assert.equal((await expenseRequest("POST",sc004ExpensesApi,{
      ...sc004BillDraft,title:"SC004 entered after lock",
      items:[{...sc004BillDraft.items[0],unitPriceMinor:"5000"}],
    },jar)).response.status,201);
    const afterLate=(await expenseRequest("GET",sc004Url,undefined,jar)).body;
    assert.equal(afterLate.lateExpenseCount,1);
    assert.equal(afterLate.snapshot.expenseCount,551);
    assert.equal((await expenseRequest("PATCH",
      `${sc004ExpensesApi}/${sc004Invoice}`,{
        expectedVersion:1,expense:{...sc004BillDraft,title:"Attempt frozen edit"},
      },jar)).response.status,409,
      "creator must not mutate invoice included in locked cycle");
    assert.equal((await expenseRequest("DELETE",
      `${sc004ExpensesApi}/${sc004Invoice}`,{expectedVersion:1},jar))
      .response.status,409,"frozen invoice cannot be deleted");

    // Confirming the cash AFTER the snapshot remains legal, but must not
    // rewrite the historic pending/confirmed amounts in sealed data.
    assert.equal((await expenseRequest("PATCH",
      `${sc004PaymentsApi}/${sc004Cash3.body.id}`,{action:"confirm"},jar))
      .response.status,200);
    const stillFrozen=(await expenseRequest("GET",sc004Url,undefined,jar)).body.snapshot;
    assert.equal(stillFrozen.confirmedCashMinor,"50000");
    assert.equal(stillFrozen.pendingCashMinor,"10000");
    assert.equal(stillFrozen.fingerprint,stored.fingerprint);
    // Creator-only completion still works AFTER all actual cash is confirmed.
    // Neither the snapshot nor group-manager authorization can complete an
    // invoice in place of its original creator.
    const sc004LastCash=await expenseRequest("POST",sc004PaymentsApi,{
      requestKey:randomUUID(),
      allocations:[{obligationId:sc004Obligation.id,amountMinor:"40000"}],
    },otherJar);
    assert.equal(sc004LastCash.response.status,201,JSON.stringify(sc004LastCash.body));
    assert.equal((await expenseRequest("PATCH",
      `${sc004PaymentsApi}/${sc004LastCash.body.id}`,{action:"confirm"},jar))
      .response.status,200);
    const sc004CompleteUrl=`${sc004ExpensesApi}/${sc004Invoice}/complete`;
    assert.equal((await expenseRequest("POST",sc004CompleteUrl,
      {expectedVersion:1},otherJar)).response.status,403,
      "debtor cannot complete another person's invoice");
    const sc004Completed=await expenseRequest("POST",sc004CompleteUrl,
      {expectedVersion:1},jar);
    assert.equal(sc004Completed.response.status,200,JSON.stringify(sc004Completed.body));
    assert.equal(sc004Completed.body.completed,true);
    assert.equal((await expenseRequest("GET",sc004Url,undefined,jar))
      .body.snapshot.fingerprint,stored.fingerprint,
      "creator completion cannot rewrite a frozen expense snapshot");

    assert.equal((await pool.query(
      `SELECT count(*)::int AS n FROM group_settlement_cycle_events
       WHERE cycle_id=$1 AND event_type='snapshot_locked'`,
      [sc003FirstId])).rows[0].n,1);
    assert.equal((await pool.query(
      `SELECT count(*)::int AS n FROM group_settlement_cycle_snapshots
       WHERE cycle_id=$1`,[sc003FirstId])).rows[0].n,1);

    // SC-005: 550 same-direction source obligations become ONE pending
    // standard settlement, with 550 allocation rows and ordinary two-party
    // confirmation. Only CI's exact disposable localhost PG runs the write.
    const sc005Url=`${sc003Api}/${sc003FirstId}/repayments`;
    const sc005Unauthorized=await expenseRequest("GET",sc005Url,undefined,new Map());
    assert.equal(sc005Unauthorized.response.status,401);
    const sc005Preview=await expenseRequest("GET",sc005Url,undefined,jar);
    assert.equal(sc005Preview.response.status,200,JSON.stringify(sc005Preview.body));
    assert.equal(sc005Preview.body.enabled,true,
      "only the known isolated PostgreSQL CI fixture exercises unreleased money writes");
    assert.equal(sc005Preview.body.scope,"one_cycle_one_direction");
    assert.equal(sc005Preview.body.pairs.length,1);
    const sc005Pair=sc005Preview.body.pairs[0];
    assert.equal(sc005Pair.debtorId,otherUser.id);
    assert.equal(sc005Pair.creditorId,registered.user.id);
    assert.equal(sc005Pair.allocationCount,550);
    assert.equal(sc005Pair.availableMinor,"550000");
    assert.equal(sc005Pair.pendingMinor,"0");
    const sc005Request=(key,fp=sc005Pair.fingerprint,note="Periodic meal costs")=>({
      expectedCycleVersion:3,requestKey:key,
      debtorId:otherUser.id,creditorId:registered.user.id,
      expectedFingerprint:fp,note,
    });
    assert.equal((await expenseRequest("POST",sc005Url,sc005Request(randomUUID()),
      new Map())).response.status,401);
    assert.equal((await expenseRequest("POST",sc005Url,sc005Request(randomUUID()),
      thirdJar)).response.status,403,
      "a manager or admin who is not a counterparty cannot request cash");
    assert.equal((await expenseRequest("POST",sc005Url,{
      ...sc005Request(randomUUID()),debtorId:registered.user.id,
      creditorId:otherUser.id,
    },otherJar)).response.status,409,
      "cash obligations cannot be reversed between the pair");
    assert.equal((await expenseRequest("POST",sc005Url,{
      ...sc005Request(randomUUID()),unexpected:true,
    },otherJar)).response.status,400);
    assert.equal((await expenseRequest("POST",sc005Url,{
      ...sc005Request(randomUUID()),expectedCycleVersion:2,
    },otherJar)).response.status,400,
      "must be exactly the locked cycle version");
    assert.equal((await expenseRequest("POST",`${sc003Api}/${sc003Pending.id}/repayments`,
      sc005Request(randomUUID()),otherJar)).response.status,409,
      "open cycle cannot authorize cash");

    const sc005BulkDebt=(await pool.query(
      `SELECT o.id FROM obligations o JOIN expenses e ON e.id=o.expense_id
       WHERE o.group_id=$1 AND e.title LIKE 'SC004 Bulk %'
       ORDER BY o.id LIMIT 1`,
      [sc003Group])).rows[0].id;
    const sc005OtherPending=await expenseRequest("POST",sc004PaymentsApi,{
      requestKey:randomUUID(),
      allocations:[{obligationId:sc005BulkDebt,amountMinor:"250"}],
    },otherJar);
    assert.equal(sc005OtherPending.response.status,201);
    assert.equal((await expenseRequest("POST",sc005Url,
      sc005Request(randomUUID()),otherJar)).response.status,409,
      "pending cash reservation changed: stale pair fingerprint must fail");
    const sc005NewPreview=await expenseRequest("GET",sc005Url,undefined,otherJar);
    assert.equal(sc005NewPreview.response.status,200);
    const sc005Fresh=sc005NewPreview.body.pairs[0];
    assert.equal(sc005Fresh.allocationCount,550);
    assert.equal(sc005Fresh.availableMinor,"549750");
    assert.equal(sc005Fresh.pendingMinor,"250");
    assert.notEqual(sc005Fresh.fingerprint,sc005Pair.fingerprint);

    const sc005KeyA=randomUUID(),sc005KeyB=randomUUID();
    const sc005Race=await Promise.all([
      expenseRequest("POST",sc005Url,
        sc005Request(sc005KeyA,sc005Fresh.fingerprint),otherJar),
      expenseRequest("POST",sc005Url,
        sc005Request(sc005KeyB,sc005Fresh.fingerprint),otherJar),
    ]);
    assert.deepEqual(sc005Race.map(x=>x.response.status).sort(),[201,409],
      "concurrent same-pair requests cannot double reserve cash");
    const sc005Winner=sc005Race.findIndex(x=>x.response.status===201);
    const sc005Created=sc005Race[sc005Winner].body;
    const sc005WinnerKey=sc005Winner===0?sc005KeyA:sc005KeyB;
    assert.equal(sc005Created.status,"pending");
    assert.equal(sc005Created.amountMinor,"549750");
    assert.equal(sc005Created.allocationCount,550);
    const sc005Stored=(await pool.query(
      `SELECT count(*)::int AS count,
         COALESCE(sum(amount_minor),0)::text AS amount
       FROM settlement_allocations WHERE settlement_id=$1`,
      [sc005Created.id])).rows[0];
    assert.deepEqual(sc005Stored,{count:550,amount:"549750"});
    assert.equal((await pool.query(
      `SELECT count(*)::int AS n
       FROM group_settlement_cycle_repayments
       WHERE settlement_id=$1 AND cycle_id=$2`,
      [sc005Created.id,sc003FirstId])).rows[0].n,1);
    const sc005Again=await expenseRequest("POST",sc005Url,
      sc005Request(sc005WinnerKey,sc005Fresh.fingerprint),otherJar);
    assert.equal(sc005Again.response.status,200,
      "lost response: same idempotency key retrieves original batch");
    assert.equal(sc005Again.body.id,sc005Created.id);
    assert.equal((await expenseRequest("POST",sc005Url,
      sc005Request(sc005WinnerKey,sc005Fresh.fingerprint,"Changed note"),
      otherJar)).response.status,409,
      "same idempotency key with modified note is a conflict");

    // SQL bypass attempts must not mutate the saved 550 allocations or
    // impersonate either counterparty. These direct writes must be denied.
    await assert.rejects(pool.query(
      `UPDATE settlement_allocations SET amount_minor=amount_minor+1
       WHERE settlement_id=$1`,[sc005Created.id]),
      /SC-005 batch allocations are immutable/);
    await assert.rejects(pool.query(
      `DELETE FROM settlement_allocations WHERE settlement_id=$1`,
      [sc005Created.id]),/SC-005 batch allocations are immutable/);
    await assert.rejects(pool.query(
      `UPDATE group_settlement_cycle_repayments SET allocation_count=1
       WHERE settlement_id=$1`,[sc005Created.id]),/append-only/);
    await assert.rejects(pool.query(
      `UPDATE settlements SET status='confirmed',
       resolved_at=clock_timestamp(),resolved_by=$2 WHERE id=$1`,
      [sc005Created.id,otherUser.id]),/SC-005 batch payment cannot be altered/);
    await assert.rejects(pool.query(
      `DELETE FROM settlements WHERE id=$1`,
      [sc005Created.id]),/SC-005 batch payment cannot be altered/);
    await assert.rejects(pool.query(
      `DELETE FROM settlement_events WHERE settlement_id=$1`,
      [sc005Created.id]),/SC-005 settlement events are append-only/);

    // Direct SQL cannot associate a legacy settlement with another cycle
    // or pretend the original settlement amount was a larger batch.
    await assert.rejects(pool.query(
      `INSERT INTO group_settlement_cycle_repayments
       (settlement_id,group_id,cycle_id,debtor_id,creditor_id,
        initiated_by,preview_fingerprint,allocation_count,amount_minor)
       VALUES($1,$2,$3,$4,$5,$4,$6,1,250)`,
      [sc005OtherPending.body.id,sc003Group,sc003Pending.id,
        otherUser.id,registered.user.id,sc005Fresh.fingerprint]),
      /SC-005 repayment cannot bind invalid/);
    await assert.rejects(pool.query(
      `INSERT INTO group_settlement_cycle_repayments
       (settlement_id,group_id,cycle_id,debtor_id,creditor_id,
        initiated_by,preview_fingerprint,allocation_count,amount_minor)
       VALUES($1,$2,$3,$4,$5,$4,$6,1,251)`,
      [sc005OtherPending.body.id,sc003Group,sc003FirstId,
        otherUser.id,registered.user.id,sc005Fresh.fingerprint]),
      /SC-005 repayment cannot bind invalid/);

    const sc005PaymentUrl=`${sc004PaymentsApi}/${sc005Created.id}`;
    const sc005Owed=(await pool.query(
      `SELECT amount_minor::text, status FROM settlements WHERE id=$1`,
      [sc005Created.id])).rows[0];
    assert.deepEqual(sc005Owed,{amount_minor:"549750",status:"pending"},
      "batch request reserves cash, it does NOT discharge the debt");
    assert.equal((await expenseRequest("PATCH",sc005PaymentUrl,
      {action:"confirm"},otherJar)).response.status,403,
      "initiator cannot confirm their own batch payment");
    assert.equal((await expenseRequest("PATCH",sc005PaymentUrl,
      {action:"confirm"},thirdJar)).response.status,403,
      "admin cannot impersonate either counterparty");
    assert.equal((await expenseRequest("PATCH",sc005PaymentUrl,
      {action:"confirm"},jar)).response.status,200,
      "actual creditor confirms all 550 allocations together");
    assert.equal((await expenseRequest("PATCH",sc005PaymentUrl,
      {action:"confirm"},jar)).response.status,409,
      "one batch cannot be confirmed twice");
    assert.equal((await pool.query(
      "SELECT status FROM settlements WHERE id=$1",
      [sc005Created.id])).rows[0].status,"confirmed");
    assert.equal((await expenseRequest("GET",sc004Url,undefined,jar))
      .body.snapshot.fingerprint,stored.fingerprint,
      "batch repayment cannot modify immutable SC-004 snapshot");
    assert.equal((await pool.query(
      `SELECT count(*)::int AS n FROM group_settlement_cycle_repayments
       WHERE cycle_id=$1`,[sc003FirstId])).rows[0].n,1);

    // Once the separate 250 VND pending reservation is cancelled by its
    // initiator, that exact amount becomes available again. A second
    // cycle-scoped request may cover only that amount, without paying
    // anyone outside the A->B direction or double-counting old cash.
    assert.equal((await expenseRequest("PATCH",
      `${sc004PaymentsApi}/${sc005OtherPending.body.id}`,
      {action:"cancel"},otherJar)).response.status,200);
    const sc005Residual=(await expenseRequest("GET",sc005Url,undefined,jar)).body.pairs[0];
    assert.equal(sc005Residual.availableMinor,"250");
    assert.equal(sc005Residual.allocationCount,1);
    // A rejected batch does not discharge money; reservations become
    // available for a NEW request, never implicitly reuse the rejected one.
    const rejectedBatch=await expenseRequest("POST",sc005Url,
      sc005Request(randomUUID(),sc005Residual.fingerprint,"First residual"),
      jar);
    assert.equal(rejectedBatch.response.status,201);
    assert.equal((await expenseRequest("PATCH",
      `${sc004PaymentsApi}/${rejectedBatch.body.id}`,
      {action:"reject"},otherJar)).response.status,200);
    const afterRejection=(await expenseRequest("GET",sc005Url,undefined,jar)).body.pairs[0];
    assert.equal(afterRejection.availableMinor,"250");
    assert.equal(afterRejection.allocationCount,1);

    // Concurrent identical request keys (double click/lost first response)
    // must produce ONE settlement and return its same id to both callers.
    const residualKey=randomUUID();
    const residualRequests=await Promise.all([
      expenseRequest("POST",sc005Url,
        sc005Request(residualKey,afterRejection.fingerprint,"Residual cash"),jar),
      expenseRequest("POST",sc005Url,
        sc005Request(residualKey,afterRejection.fingerprint,"Residual cash"),jar),
    ]);
    assert.deepEqual(residualRequests.map(x=>x.response.status).sort(),[200,201],
      "concurrent same-key requests are exactly once");
    assert.equal(residualRequests[0].body.id,residualRequests[1].body.id);
    const sc005CreditorRequest=residualRequests.find(x=>x.response.status===201);
    assert.equal(sc005CreditorRequest.body.amountMinor,"250");
    assert.equal(sc005CreditorRequest.body.allocationCount,1);
    assert.equal((await expenseRequest("PATCH",
      `${sc004PaymentsApi}/${sc005CreditorRequest.body.id}`,
      {action:"confirm"},jar)).response.status,403,
      "creditor who reports receiving cash cannot approve own request");
    assert.equal((await expenseRequest("PATCH",
      `${sc004PaymentsApi}/${sc005CreditorRequest.body.id}`,
      {action:"confirm"},otherJar)).response.status,200,
      "debtor confirms the creditor-initiated cash request");
    assert.equal((await expenseRequest("GET",sc005Url,undefined,jar))
      .body.pairs.length,0,"all live same-direction cash now confirmed");
    assert.equal((await pool.query(
      `SELECT count(*)::int AS n FROM group_settlement_cycle_repayments
       WHERE cycle_id=$1`,[sc003FirstId])).rows[0].n,3);

    // Disabling a group denies NEW locking, but a lost-response retry must
    // still read the EXACT immutable receipt that committed previously.
    assert.equal((await expenseRequest("PATCH",sc003SettingUrl,
      config(1,false,false),jar)).response.status,200);
    const sc004AfterDisable=await expenseRequest("POST",sc004Url,{
      expectedVersion:2,requestKey:requests[sc004Winner].requestKey,
      expectedFingerprint:sc004Reviewed.fingerprint,
    },requests[sc004Winner].jar);
    assert.equal(sc004AfterDisable.response.status,200,
      "disable does not erase already committed idempotent lock receipt");
    assert.equal(sc004AfterDisable.body.snapshot.fingerprint,stored.fingerprint);
    assert.equal((await expenseRequest("POST",sc004Url,{
      expectedVersion:2,requestKey:randomUUID(),
      expectedFingerprint:sc004Reviewed.fingerprint,
    },jar)).response.status,409,
      "disabled group cannot issue any new snapshot lock");

    // Idempotent retry survives group opt-out, while a fresh batch request
    // remains forbidden. UI must report disabled, not pretend money is live.
    const sc005Disabled=(await expenseRequest("GET",sc005Url,undefined,jar)).body;
    assert.equal(sc005Disabled.enabled,false);
    assert.equal((await expenseRequest("POST",sc005Url,
      sc005Request(sc005WinnerKey,sc005Fresh.fingerprint),otherJar))
      .response.status,200,"original batch receipt survives opt-out");
    assert.equal((await expenseRequest("POST",sc005Url,
      sc005Request(randomUUID(),sc005Fresh.fingerprint),otherJar))
      .response.status,409,"opt-out cannot start a new cash request");


    // BN-002 isolated proposal fixture: opposite-direction original invoices
    // in ONE locked period. The proposal is not an allocation or reservation.
    const bnGroup=randomUUID(),bnRev=randomUUID();
    await pool.query("INSERT INTO groups(id,owner_id,name) VALUES($1,$2,'BN002 two-way')",
      [bnGroup,registered.user.id]);
    for(const [memberId,role] of [
      [registered.user.id,"owner"],[otherUser.id,"member"],[thirdUser.id,"admin"]])
      await pool.query(
        "INSERT INTO group_members(group_id,user_id,role) VALUES($1,$2,$3)",
        [bnGroup,memberId,role]);
    const bnSetting=`${origin}/api/groups/${bnGroup}/settlement-cycle/settings`;
    const bnCycleApi=`${origin}/api/groups/${bnGroup}/settlement-cycle/cycles`;
    const bnExpenses=`${origin}/api/groups/${bnGroup}/expenses`;
    const bnCash=`${origin}/api/groups/${bnGroup}/settlements`;
    assert.equal((await expenseRequest("PATCH",bnSetting,
      config(0,true,false),jar)).response.status,200);
    await pool.query(`UPDATE group_settlement_config_events
      SET recorded_at=$2::timestamptz WHERE group_id=$1
        AND event_type='settings_changed'`,
      [bnGroup,sc003Date(-7)+"T00:00:00Z"]);
    await pool.query(
      "INSERT INTO group_settlement_schedule_heads(group_id,updated_by) VALUES($1,$2)",
      [bnGroup,registered.user.id]);
    await pool.query(`INSERT INTO group_settlement_schedule_revisions
      (id,group_id,version,frequency,time_zone,anchor_date,effective_at,created_by)
      VALUES($1,$2,1,'manual','UTC',$3,$4,$5)`,
      [bnRev,bnGroup,sc003Date(-6),sc003Date(-6)+"T00:00:00Z",registered.user.id]);
    const bnMade=await expenseRequest("POST",bnCycleApi,{
      expectedScheduleVersion:1,requestKey:randomUUID(),
      startDate:sc003Date(-3),endDate:sc003Date(-1),
    },jar);
    assert.equal(bnMade.response.status,201,JSON.stringify(bnMade.body));
    const bnCycle=bnMade.body.cycle.id;
    assert.equal((await expenseRequest("POST",`${bnCycleApi}/${bnCycle}/review`,
      {expectedVersion:1},jar)).response.status,200);
    const bnForward=await expenseRequest("POST",bnExpenses,{
      title:"BN002 A paid dinner",occurredOn:sc003Date(-2),
      payerId:registered.user.id,items:[{name:"A paid",quantity:1,
        unitPriceMinor:"130000",participants:[otherUser.id]}],
    },jar);
    assert.equal(bnForward.response.status,201,JSON.stringify(bnForward.body));
    const bnBackward=await expenseRequest("POST",bnExpenses,{
      title:"BN002 B paid groceries",occurredOn:sc003Date(-2),
      payerId:otherUser.id,items:[{name:"B paid",quantity:1,
        unitPriceMinor:"100000",participants:[registered.user.id]}],
    },otherJar);
    assert.equal(bnBackward.response.status,201,JSON.stringify(bnBackward.body));
    // 120 extra ORIGINAL obligations, 60 each way (oldest local date).
    // The proposed amount will need 61 positive allocations per direction.
    await pool.query(`INSERT INTO expenses
      (id,group_id,payer_id,created_by,title,occurred_on,total_minor)
      SELECT gen_random_uuid(),$1,
        CASE WHEN g<=60 THEN $2 ELSE $3 END,
        CASE WHEN g<=60 THEN $2 ELSE $3 END,
        'BN002 Bulk '||g,$4::date,1000
      FROM generate_series(1,120) AS g`,
      [bnGroup,registered.user.id,otherUser.id,sc003Date(-3)]);
    await pool.query(`INSERT INTO expense_items
      (id,expense_id,group_id,position,name,quantity,unit_price_minor,amount_minor)
      SELECT gen_random_uuid(),id,group_id,0,'Bulk',1,1000,1000
      FROM expenses WHERE group_id=$1 AND title LIKE 'BN002 Bulk %'`,[bnGroup]);
    await pool.query(`INSERT INTO expense_item_shares
      (item_id,group_id,user_id,amount_minor)
      SELECT i.id,i.group_id,
        CASE WHEN e.payer_id=$2 THEN $3 ELSE $2 END,1000
      FROM expense_items i JOIN expenses e ON e.id=i.expense_id
      WHERE e.group_id=$1 AND e.title LIKE 'BN002 Bulk %'`,
      [bnGroup,registered.user.id,otherUser.id]);
    await pool.query(`INSERT INTO obligations
      (id,group_id,expense_id,expense_version,debtor_id,creditor_id,amount_minor)
      SELECT gen_random_uuid(),e.group_id,e.id,1,
        CASE WHEN e.payer_id=$2 THEN $3 ELSE $2 END,e.payer_id,1000
      FROM expenses e WHERE e.group_id=$1 AND e.title LIKE 'BN002 Bulk %'`,
      [bnGroup,registered.user.id,otherUser.id]);
    await pool.query(`INSERT INTO obligation_sources
      (id,obligation_id,expense_item_id,item_name,amount_minor)
      SELECT gen_random_uuid(),o.id,i.id,'Bulk',1000
      FROM obligations o JOIN expense_items i ON i.expense_id=o.expense_id
      JOIN expenses e ON e.id=o.expense_id
      WHERE e.group_id=$1 AND e.title LIKE 'BN002 Bulk %'`,[bnGroup]);
    const bnOb=(await pool.query(`SELECT id,debtor_id,creditor_id
      FROM obligations WHERE expense_id=ANY($1::uuid[]) ORDER BY id`,
      [[bnForward.body.id,bnBackward.body.id]])).rows;
    assert.equal(bnOb.length,2);
    const bnCashOb=bnOb.find(o=>o.debtor_id===registered.user.id);
    const bnPending=await expenseRequest("POST",bnCash,{
      requestKey:randomUUID(),
      allocations:[{obligationId:bnCashOb.id,amountMinor:"20000"}],
    },jar);
    assert.equal(bnPending.response.status,201);
    const bnSnapshotUrl=`${bnCycleApi}/${bnCycle}/snapshot`;
    const bnSnapshotPreview=(await expenseRequest("GET",bnSnapshotUrl,undefined,jar)).body.snapshot;
    assert.equal(bnSnapshotPreview.state,"review");
    assert.equal((await expenseRequest("POST",bnSnapshotUrl,{
      expectedVersion:2,requestKey:randomUUID(),
      expectedFingerprint:bnSnapshotPreview.fingerprint,
    },jar)).response.status,200);

    const bnProposalUrl=`${bnCycleApi}/${bnCycle}/bilateral-proposals`;
    const bnReadUrl=`${bnProposalUrl}?partyAId=${encodeURIComponent(registered.user.id)}&partyBId=${encodeURIComponent(otherUser.id)}`;
    assert.equal((await expenseRequest("GET",bnReadUrl,undefined,new Map()))
      .response.status,401);
    assert.equal((await expenseRequest("GET",bnReadUrl,undefined,thirdJar))
      .response.status,403,"unrelated group admin cannot inspect a bilateral document");
    assert.equal((await expenseRequest("GET",bnProposalUrl,undefined,jar))
      .response.status,400,"pair must be explicit");
    const bnReadOff=await expenseRequest("GET",bnReadUrl,undefined,jar);
    assert.equal(bnReadOff.response.status,200,JSON.stringify(bnReadOff.body));
    assert.equal(bnReadOff.body.writable,false);
    assert.equal(bnReadOff.body.calculation.offsetMinor,"140000");
    assert.equal(bnReadOff.body.eligibleSourceCount,122);
    assert.equal(bnReadOff.body.approvalEnabled,false);
    const bnPayload=(version,key,fingerprint)=>({
      partyAId:registered.user.id,partyBId:otherUser.id,
      expectedVersion:version,requestKey:key,expectedFingerprint:fingerprint,
    });
    assert.equal((await expenseRequest("POST",bnProposalUrl,
      bnPayload(0,randomUUID(),bnReadOff.body.fingerprint),jar)).response.status,409,
      "bilateral netting preference must be separately opted in");
    assert.equal((await expenseRequest("PATCH",bnSetting,
      config(1,true,true),jar)).response.status,200);
    const bnLive=await expenseRequest("GET",bnReadUrl,undefined,otherJar);
    assert.equal(bnLive.response.status,200,JSON.stringify(bnLive.body));
    assert.equal(bnLive.body.writable,true);
    assert.equal(bnLive.body.currentVersion,0);
    assert.equal(bnLive.body.current,null);
    assert.deepEqual([
      bnLive.body.calculation.aOwesB.availableBeforeMinor,
      bnLive.body.calculation.bOwesA.availableBeforeMinor,
    ].sort(),["140000","190000"].sort(),
      "canonical unordered pair must not depend on Better Auth user ID sort");

    const bnRejectedInput=await expenseRequest("POST",bnProposalUrl,{
      ...bnPayload(0,randomUUID(),bnLive.body.fingerprint),
      amountMinor:"1",
    },jar);
    assert.equal(bnRejectedInput.response.status,400,
      "client must never supply monetary allocations or amount");
    assert.equal((await expenseRequest("POST",bnProposalUrl,
      bnPayload(0,randomUUID(),bnLive.body.fingerprint),thirdJar))
      .response.status,403,"third person cannot propose for the pair");
    assert.equal((await expenseRequest("POST",bnProposalUrl,
      bnPayload(0,randomUUID(),"0".repeat(64)),jar)).response.status,409,
      "fingerprint cannot be forged");
    const bnBefore=(await pool.query(`SELECT
      (SELECT count(*)::int FROM settlements WHERE group_id=$1) AS cash,
      (SELECT count(*)::int FROM settlement_allocations WHERE group_id=$1) AS allocations`,
      [bnGroup])).rows[0];
    const bnKeyA=randomUUID(),bnKeyB=randomUUID();
    const bnRace=await Promise.all([
      expenseRequest("POST",bnProposalUrl,
        bnPayload(0,bnKeyA,bnLive.body.fingerprint),jar),
      expenseRequest("POST",bnProposalUrl,
        bnPayload(0,bnKeyB,bnLive.body.fingerprint),otherJar),
    ]);
    assert.deepEqual(bnRace.map(x=>x.response.status).sort(),[201,409],
      "two signatories cannot publish the same pair version concurrently");
    const bnWinner=bnRace.findIndex(x=>x.response.status===201);
    const bnFirst=bnRace[bnWinner].body.proposal;
    assert.equal(bnFirst.version,1);
    assert.equal(bnFirst.offsetMinor,"140000");
    assert.equal(bnFirst.sourceCount,122);
    assert.equal(bnFirst.allocationCount,122);
    assert.equal(bnRace[bnWinner].body.approvalEnabled,false);
    const bnAuthor=bnWinner===0?jar:otherJar;
    const bnSameKey=bnWinner===0?bnKeyA:bnKeyB;
    const bnAgain=await expenseRequest("POST",bnProposalUrl,
      bnPayload(0,bnSameKey,bnLive.body.fingerprint),bnAuthor);
    assert.equal(bnAgain.response.status,200,"lost response is idempotent");
    assert.equal(bnAgain.body.proposal.id,bnFirst.id);
    assert.equal((await expenseRequest("POST",bnProposalUrl,
      bnPayload(0,bnSameKey,"1".repeat(64)),bnAuthor)).response.status,409);
    assert.equal((await expenseRequest("POST",bnProposalUrl,
      bnPayload(1,randomUUID(),bnLive.body.fingerprint),jar)).response.status,409,
      "cannot publish another version without a changed eligible ledger");
    const bnSources=(await pool.query(`SELECT debtor_id,creditor_id,
      proposed_minor::text,available_before_minor::text
      FROM group_settlement_bilateral_sources
      WHERE proposal_id=$1 ORDER BY obligation_id`,[bnFirst.id])).rows;
    assert.equal(bnSources.length,122);
    for(const [debtor,creditor] of [
      [registered.user.id,otherUser.id],
      [otherUser.id,registered.user.id]]){
      const direction=bnSources.filter(x=>x.debtor_id===debtor &&
        x.creditor_id===creditor);
      assert.equal(direction.length,61);
      assert.equal(direction.reduce((n,x)=>n+BigInt(x.proposed_minor),0n),
        140000n,"equal original-obligation allocations in both directions");
      assert.equal(direction.filter(x=>BigInt(x.proposed_minor)>0n).length,61);
    }
    assert.equal((await pool.query(
      "SELECT count(*)::int AS n FROM group_settlement_bilateral_proposals WHERE group_id=$1",
      [bnGroup])).rows[0].n,1);
    await assert.rejects(pool.query(
      `UPDATE group_settlement_bilateral_sources
       SET proposed_minor=proposed_minor-1 WHERE proposal_id=$1`,
      [bnFirst.id]),/immutable/);
    await assert.rejects(pool.query(
      `UPDATE group_settlement_bilateral_proposals SET offset_minor=1 WHERE id=$1`,
      [bnFirst.id]),/immutable/);
    await assert.rejects(pool.query(
      `DELETE FROM group_settlement_bilateral_heads WHERE group_id=$1`,
      [bnGroup]),/cannot be deleted/);
    const bnAfter=(await pool.query(`SELECT
      (SELECT count(*)::int FROM settlements WHERE group_id=$1) AS cash,
      (SELECT count(*)::int FROM settlement_allocations WHERE group_id=$1) AS allocations`,
      [bnGroup])).rows[0];
    assert.deepEqual(bnAfter,bnBefore,
      "proposal storage must never modify cash rows or existing allocation amounts");

    // Confirming cash after proposal publication makes the old immutable
    // proposal stale; new version requires explicit new preview/version.
    assert.equal((await expenseRequest("PATCH",
      `${bnCash}/${bnPending.body.id}`,{action:"confirm"},otherJar))
      .response.status,200);
    const bnReprice=await expenseRequest("GET",bnReadUrl,undefined,jar);
    assert.equal(bnReprice.response.status,200);
    assert.equal(bnReprice.body.currentVersion,1);
    assert.equal(bnReprice.body.staleCurrent,true);
    assert.notEqual(bnReprice.body.fingerprint,bnLive.body.fingerprint);
    assert.equal((await expenseRequest("POST",bnProposalUrl,
      bnPayload(1,randomUUID(),bnLive.body.fingerprint),jar)).response.status,409);
    // Simultaneous identical request keys are not two revisions.
    // The committed result survives a lost first HTTP response.
    const bnSecondKey=randomUUID();
    const bnSameKeyRace=await Promise.all([
      expenseRequest("POST",bnProposalUrl,
        bnPayload(1,bnSecondKey,bnReprice.body.fingerprint),otherJar),
      expenseRequest("POST",bnProposalUrl,
        bnPayload(1,bnSecondKey,bnReprice.body.fingerprint),otherJar),
    ]);
    assert.deepEqual(bnSameKeyRace.map(x=>x.response.status).sort(),[200,201],
      "double-click proposal must publish one immutable version");
    assert.equal(bnSameKeyRace[0].body.proposal.id,
      bnSameKeyRace[1].body.proposal.id);
    const bnSecond=bnSameKeyRace.find(x=>x.response.status===201);
    assert.equal(bnSecond.body.proposal.version,2);
    assert.equal((await pool.query(
      `SELECT version,offset_minor::text FROM group_settlement_bilateral_proposals
       WHERE group_id=$1 ORDER BY version`,[bnGroup])).rows.length,2);
    assert.equal((await pool.query(
      `SELECT offset_minor::text AS amount FROM group_settlement_bilateral_proposals
       WHERE id=$1`,[bnFirst.id])).rows[0].amount,"140000",
      "historical proposal version remains immutable after cash confirmation");
    // Adversarial SQL: equal totals but WRONG FIFO ordering must never
    // become the published version. No partial commit may survive.
    const bnSpoofId=randomUUID(),bnSpoofKey=randomUUID();
    const bnSmallOb=(await pool.query(`SELECT o.id FROM obligations o
      JOIN expenses e ON e.id=o.expense_id WHERE e.group_id=$1
        AND e.title='BN002 Bulk 1'`,[bnGroup])).rows[0].id;
    const bnMainOb=(await pool.query(
      "SELECT id FROM obligations WHERE expense_id=$1",
      [bnForward.body.id])).rows[0].id;
    const bnClient=await pool.connect();
    try{
      await bnClient.query("BEGIN");
      await bnClient.query(`INSERT INTO group_settlement_bilateral_proposals
        (id,group_id,cycle_id,party_low,party_high,version,request_key,
         request_digest,source_fingerprint,snapshot_fingerprint,created_by,
         offset_minor,source_count,allocation_count)
        SELECT $2,group_id,cycle_id,party_low,party_high,3,$3,
          $4,source_fingerprint,snapshot_fingerprint,$5,
          offset_minor,source_count,allocation_count-1
        FROM group_settlement_bilateral_proposals WHERE id=$1`,
        [bnSecond.body.proposal.id,bnSpoofId,bnSpoofKey,"a".repeat(64),
          registered.user.id]);
      await bnClient.query(`INSERT INTO group_settlement_bilateral_sources
        (proposal_id,group_id,cycle_id,party_low,party_high,obligation_id,
         debtor_id,creditor_id,occurred_on,expense_version,original_minor,
         confirmed_cash_minor,pending_cash_minor,confirmed_setoff_minor,
         pending_setoff_minor,available_before_minor,proposed_minor,
         available_after_minor)
        SELECT $2,group_id,cycle_id,party_low,party_high,obligation_id,
          debtor_id,creditor_id,occurred_on,expense_version,original_minor,
          confirmed_cash_minor,pending_cash_minor,confirmed_setoff_minor,
          pending_setoff_minor,available_before_minor,
          CASE WHEN obligation_id=$3 THEN 0
               WHEN obligation_id=$4 THEN proposed_minor+1000
               ELSE proposed_minor END,
          available_before_minor-
          CASE WHEN obligation_id=$3 THEN 0
               WHEN obligation_id=$4 THEN proposed_minor+1000
               ELSE proposed_minor END
        FROM group_settlement_bilateral_sources WHERE proposal_id=$1`,
        [bnSecond.body.proposal.id,bnSpoofId,bnSmallOb,bnMainOb]);
      await assert.rejects(bnClient.query(`UPDATE group_settlement_bilateral_heads
        SET version=3,current_proposal_id=$2
        WHERE group_id=$1 AND cycle_id=$3`,
        [bnGroup,bnSpoofId,bnCycle]),/BN-002 noncanonical source allocation order/);
    }finally{await bnClient.query("ROLLBACK");bnClient.release();}
    assert.equal((await pool.query(
      "SELECT version FROM group_settlement_bilateral_heads WHERE group_id=$1",
      [bnGroup])).rows[0].version,2,
      "tampered proposal must never publish or change the current head");
    assert.equal((await pool.query(
      "SELECT count(*)::int AS n FROM group_settlement_bilateral_proposals WHERE group_id=$1",
      [bnGroup])).rows[0].n,2,
      "tampered proposal must be fully rolled back");

    // A creator may complete an already fully PAID source invoice without
    // altering the immutable original obligation. This metadata version
    // increment must not make all remaining opposite-side debts unqueryable.
    const bnAllPaid=await expenseRequest("POST",bnCash,{
      requestKey:randomUUID(),allocations:[
        {obligationId:bnSmallOb,amountMinor:"1000"}],
    },otherJar);
    assert.equal(bnAllPaid.response.status,201);
    assert.equal((await expenseRequest("PATCH",`${bnCash}/${bnAllPaid.body.id}`,
      {action:"confirm"},jar)).response.status,200);
    const bnBeforeComplete=(await expenseRequest("GET",bnReadUrl,undefined,jar)).body;
    const bnComplete=await expenseRequest("POST",
      `${bnExpenses}/${(await pool.query(
        "SELECT expense_id FROM obligations WHERE id=$1",[bnSmallOb]
      )).rows[0].expense_id}/complete`,{expectedVersion:1},jar);
    assert.equal(bnComplete.response.status,200,JSON.stringify(bnComplete.body));
    const bnAfterComplete=await expenseRequest("GET",bnReadUrl,undefined,jar);
    assert.equal(bnAfterComplete.response.status,200);
    assert.equal(bnAfterComplete.body.fingerprint,bnBeforeComplete.fingerprint,
      "creator completion does not change financial source values");

    assert.equal((await expenseRequest("PATCH",bnSetting,
      config(2,false,false),jar)).response.status,200);
    assert.equal((await expenseRequest("POST",bnProposalUrl,
      bnPayload(1,bnSameKey,bnLive.body.fingerprint),bnAuthor))
      .response.status,409,"same key with a changed version is denied");
    assert.equal((await expenseRequest("POST",bnProposalUrl,
      bnPayload(0,bnSameKey,bnLive.body.fingerprint),bnAuthor))
      .response.status,200,"committed idempotent receipt survives disabling group");
    assert.equal((await expenseRequest("POST",bnProposalUrl,
      bnPayload(2,randomUUID(),bnReprice.body.fingerprint),jar))
      .response.status,409,"disabled group cannot publish new proposal");
    assert.equal((await pool.query(
      `SELECT count(*)::int AS n FROM group_settlement_bilateral_proposals
       WHERE group_id=$1`,[bnGroup])).rows[0].n,2);
    // Both allocations were created explicitly through the existing cash
    // API; merely creating proposals never added a settlement allocation.
    assert.equal((await pool.query(
      `SELECT count(*)::int AS n FROM settlement_allocations WHERE group_id=$1`,
      [bnGroup])).rows[0].n,2);

    // BN-003 decision lifecycle; NO ledger application whatsoever.
    // Re-enable preparation after BN-002 opt-out to isolate signatory rules.
    assert.equal((await expenseRequest("PATCH",bnSetting,
      config(3,true,true),jar)).response.status,200);
    const bnDecisionUrl=id=>`${bnProposalUrl}/${id}/decisions`;
    const decisionBody=(action,version,fingerprint,requestKey=randomUUID())=>({
      action,expectedVersion:version,expectedFingerprint:fingerprint,requestKey,
    });
    const oldUrl=bnDecisionUrl(bnFirst.id);
    const oldDecisionView=(await expenseRequest("GET",oldUrl,undefined,otherJar)).body;
    assert.equal(oldDecisionView.isCurrent,false,
      "previous proposal cannot become current after new version");
    assert.equal(oldDecisionView.status,"invalidated",
      "automatic cash invalidation is immutable, even after supersession");
    assert.equal((await expenseRequest("POST",oldUrl,
      decisionBody("approve",1,bnFirst.sourceFingerprint),otherJar))
      .response.status,409);
    const bnStaleUrl=bnDecisionUrl(bnSecond.body.proposal.id);
    const initialStale=await expenseRequest("GET",bnStaleUrl,undefined,jar);
    assert.equal(initialStale.response.status,200);
    assert.equal(initialStale.body.status,"invalidated",
      "confirmed payment after proposal publication invalidates signatures");
    assert.equal((await expenseRequest("POST",bnStaleUrl,
      decisionBody("approve",2,bnSecond.body.proposal.sourceFingerprint),jar))
      .response.status,409,"stale document cannot collect an approval");
    assert.equal((await pool.query(`SELECT count(*)::int AS n
      FROM group_settlement_bilateral_decision_events
      WHERE proposal_id=$1 AND event_type='invalidated'`,
      [bnSecond.body.proposal.id])).rows[0].n,1,
      "invalidated event persists even though the HTTP approval returns 409");

    const bnRevision3=await expenseRequest("POST",bnProposalUrl,
      bnPayload(2,randomUUID(),bnAfterComplete.body.fingerprint),jar);
    assert.equal(bnRevision3.response.status,201,JSON.stringify(bnRevision3.body));
    const bnThird=bnRevision3.body.proposal;
    assert.equal(bnThird.version,3);
    const decisionUrl=bnDecisionUrl(bnThird.id);
    assert.equal((await expenseRequest("GET",decisionUrl,undefined,new Map()))
      .response.status,401);
    assert.equal((await expenseRequest("GET",decisionUrl,undefined,thirdJar))
      .response.status,403,"unrelated admin is not a signatory");
    assert.equal((await expenseRequest("POST",decisionUrl,
      decisionBody("approve",3,bnThird.sourceFingerprint),thirdJar))
      .response.status,403);
    assert.equal((await expenseRequest("POST",decisionUrl,{
      ...decisionBody("approve",3,bnThird.sourceFingerprint),actorId:thirdUser.id,
    },jar)).response.status,400,"no client-supplied identity");
    const aKey=randomUUID();
    const sameSigner=await Promise.all([
      expenseRequest("POST",decisionUrl,
        decisionBody("approve",3,bnThird.sourceFingerprint,aKey),jar),
      expenseRequest("POST",decisionUrl,
        decisionBody("approve",3,bnThird.sourceFingerprint,aKey),jar),
    ]);
    assert.deepEqual(sameSigner.map(x=>x.response.status).sort(),[200,201],
      "concurrent same-key double click must record ONE signed approval");
    assert.equal(sameSigner[0].body.decisionId,sameSigner[1].body.decisionId);
    assert.equal(sameSigner[0].body.view.approvalCount,1);
    assert.equal((await expenseRequest("POST",decisionUrl,
      decisionBody("approve",3,bnThird.sourceFingerprint),jar))
      .response.status,409,"same signer cannot approve twice with new key");
    assert.equal((await expenseRequest("POST",decisionUrl,
      decisionBody("reject",3,bnThird.sourceFingerprint,aKey),jar))
      .response.status,409,"one request key cannot switch action");

    const bApprove=await expenseRequest("POST",decisionUrl,
      decisionBody("approve",3,bnThird.sourceFingerprint),otherJar);
    assert.equal(bApprove.response.status,201,JSON.stringify(bApprove.body));
    assert.equal(bApprove.body.view.status,"agreed");
    assert.equal(bApprove.body.view.approvalCount,2);
    assert.equal(bApprove.body.view.readyForApplication,false,
      "two approvals still cannot execute a financial set-off in BN-003");
    assert.equal((await expenseRequest("POST",decisionUrl,
      decisionBody("reject",3,bnThird.sourceFingerprint),otherJar))
      .response.status,409,"fully agreed version cannot be rejected; signer must revoke");
    const revokeKey=randomUUID();
    const aRevoked=await expenseRequest("POST",decisionUrl,
      decisionBody("revoke",3,bnThird.sourceFingerprint,revokeKey),jar);
    assert.equal(aRevoked.response.status,201,JSON.stringify(aRevoked.body));
    assert.equal(aRevoked.body.status,"revoked");
    assert.equal((await expenseRequest("POST",decisionUrl,
      decisionBody("revoke",3,bnThird.sourceFingerprint,revokeKey),jar))
      .response.status,200,"same revocation request is idempotent");
    assert.equal((await expenseRequest("POST",decisionUrl,
      decisionBody("approve",3,bnThird.sourceFingerprint),otherJar))
      .response.status,409,"revoked document cannot be approved again");
    const bnRevokedEvents=(await pool.query(`SELECT event_type,actor_id
      FROM group_settlement_bilateral_decision_events WHERE proposal_id=$1
      ORDER BY recorded_at,id`,[bnThird.id])).rows;
    assert.equal(bnRevokedEvents.filter(x=>x.event_type==="approve").length,2);
    assert.equal(bnRevokedEvents.filter(x=>x.event_type==="revoke").length,1);
    await assert.rejects(pool.query(`DELETE FROM group_settlement_bilateral_decision_events
      WHERE proposal_id=$1`,[bnThird.id]),/append-only/);
    await assert.rejects(pool.query(`UPDATE group_settlement_bilateral_decision_events
      SET actor_id=$2 WHERE proposal_id=$1`,[bnThird.id,thirdUser.id]),/append-only/);

    // A rejected proposal also terminates ONLY that immutable version.
    // Recreating the same live fingerprint is permitted after termination,
    // but no earlier approvals are transferred to the next version.
    const afterRevocation=await expenseRequest("POST",bnProposalUrl,
      bnPayload(3,randomUUID(),bnAfterComplete.body.fingerprint),otherJar);
    assert.equal(afterRevocation.response.status,201,JSON.stringify(afterRevocation.body));
    const fourth=afterRevocation.body.proposal;
    assert.equal(fourth.version,4);
    const fourthUrl=bnDecisionUrl(fourth.id);
    assert.equal((await expenseRequest("GET",fourthUrl,undefined,jar))
      .body.approvalCount,0);
    assert.equal((await expenseRequest("POST",fourthUrl,
      decisionBody("approve",4,fourth.sourceFingerprint,aKey),jar))
      .response.status,409,
      "same actor cannot reuse the prior proposal's request key");
    // Two different signatories race APPROVE vs REJECT, with PostgreSQL
    // serializing the immutable proposal decisions. Rejection is terminal
    // regardless of which request obtained the group lock first.
    const [fourthApprove,bn003Rejected]=await Promise.all([
      expenseRequest("POST",fourthUrl,
        decisionBody("approve",4,fourth.sourceFingerprint),jar),
      expenseRequest("POST",fourthUrl,
        decisionBody("reject",4,fourth.sourceFingerprint),otherJar),
    ]);
    assert.ok([201,409].includes(fourthApprove.response.status));
    assert.equal(bn003Rejected.response.status,201,JSON.stringify(bn003Rejected.body));
    assert.equal(bn003Rejected.body.status,"rejected");
    assert.equal((await expenseRequest("GET",fourthUrl,undefined,jar))
      .body.status,"rejected");
    assert.equal((await expenseRequest("POST",fourthUrl,
      decisionBody("approve",4,fourth.sourceFingerprint),jar))
      .response.status,409);

    const fifthResponse=await expenseRequest("POST",bnProposalUrl,
      bnPayload(4,randomUUID(),bnAfterComplete.body.fingerprint),jar);
    assert.equal(fifthResponse.response.status,201,JSON.stringify(fifthResponse.body));
    const fifth=fifthResponse.body.proposal,fifthUrl=bnDecisionUrl(fifth.id);
    assert.equal((await expenseRequest("POST",fifthUrl,
      decisionBody("approve",5,fifth.sourceFingerprint),jar))
      .response.status,201);

    // Simultaneous cash reservation changes source fingerprint while
    // approval is pending; neither stale signature nor future BN-004
    // may use the old version.
    const extraBnOb=(await pool.query(`SELECT o.id FROM obligations o
      JOIN expenses e ON e.id=o.expense_id
      WHERE e.group_id=$1 AND e.title='BN002 Bulk 2'`,[bnGroup])).rows[0].id;
    const bnChangedMoney=await expenseRequest("POST",bnCash,{
      requestKey:randomUUID(),allocations:[
        {obligationId:extraBnOb,amountMinor:"100"}],
    },otherJar);
    assert.equal(bnChangedMoney.response.status,201);
    assert.equal((await pool.query(`SELECT count(*)::int AS n
      FROM group_settlement_bilateral_decision_events
      WHERE proposal_id=$1 AND event_type='invalidated'`,
      [fifth.id])).rows[0].n,1,
      "money writer must invalidate approvals atomically at cash INSERT");
    assert.equal((await expenseRequest("GET",fifthUrl,undefined,jar))
      .body.status,"invalidated");
    assert.equal((await expenseRequest("POST",fifthUrl,
      decisionBody("approve",5,fifth.sourceFingerprint),otherJar))
      .response.status,409);
    assert.equal((await pool.query(`SELECT count(*)::int AS n FROM
      group_settlement_bilateral_decision_events
      WHERE proposal_id=$1 AND event_type='invalidated'`,
      [fifth.id])).rows[0].n,1);
    assert.equal((await pool.query(`SELECT count(*)::int AS n FROM
      group_settlement_bilateral_decision_events
      WHERE proposal_id=$1 AND event_type='approve'`,
      [fifth.id])).rows[0].n,1,
      "old approval must remain for audit, never count towards a new proposal");
    // Reverting the temporary cash reservation restores the numeric SHA,
    // but MUST NOT resurrect a signed proposal invalidated in the meantime.
    assert.equal((await expenseRequest("PATCH",
      `${bnCash}/${bnChangedMoney.body.id}`,{action:"cancel"},otherJar))
      .response.status,200);
    const restoredFingerprint=(await expenseRequest("GET",bnReadUrl,undefined,jar)).body;
    assert.equal(restoredFingerprint.fingerprint,fifth.sourceFingerprint);
    assert.equal((await expenseRequest("GET",fifthUrl,undefined,jar))
      .body.status,"invalidated",
      "immutable invalidation survives transient money changes and reversals");
    assert.equal((await expenseRequest("POST",fifthUrl,
      decisionBody("approve",5,fifth.sourceFingerprint),otherJar))
      .response.status,409);
    assert.equal((await pool.query(`SELECT count(*)::int AS n
      FROM group_settlement_bilateral_decision_events
      WHERE proposal_id=$1 AND event_type='invalidated'`,
      [fifth.id])).rows[0].n,1,
      "cash cancel must never append a second terminal event");

    // SQL-created, historically dated proposal fixture: 73 hours old. The
    // normal authenticated proposal API never accepts user-supplied dates.
    // This verifies expiration against real PostgreSQL time, NOT mock clocks.
    const sixthPreview=(await expenseRequest("GET",bnReadUrl,undefined,jar)).body;
    assert.equal(sixthPreview.currentVersion,5);
    const sixthCreated=await expenseRequest("POST",bnProposalUrl,
      bnPayload(5,randomUUID(),sixthPreview.fingerprint),otherJar);
    assert.equal(sixthCreated.response.status,201,JSON.stringify(sixthCreated.body));
    const sixth=sixthCreated.body.proposal;
    await assert.rejects(pool.query(`
      INSERT INTO group_settlement_bilateral_decision_events
        (id,proposal_id,group_id,cycle_id,party_low,party_high,
         actor_id,event_type,request_key,request_digest,source_fingerprint)
      SELECT $2,p.id,p.group_id,p.cycle_id,p.party_low,p.party_high,
        NULL,'expired',$3,$4,p.source_fingerprint
      FROM group_settlement_bilateral_proposals p WHERE p.id=$1`,
      [sixth.id,randomUUID(),randomUUID(),"a".repeat(64)]),
      /BN-003 proposal has not expired/);
    const expiredId=randomUUID();
    const expireClient=await pool.connect();
    try{
      await expireClient.query("BEGIN");
      await expireClient.query(`INSERT INTO group_settlement_bilateral_proposals
        (id,group_id,cycle_id,party_low,party_high,version,
         request_key,request_digest,source_fingerprint,snapshot_fingerprint,
         created_by,offset_minor,source_count,allocation_count,created_at)
        SELECT $2,group_id,cycle_id,party_low,party_high,7,
          $3,$4,source_fingerprint,snapshot_fingerprint,created_by,
          offset_minor,source_count,allocation_count,
          clock_timestamp()-interval '73 hours'
        FROM group_settlement_bilateral_proposals WHERE id=$1`,
        [sixth.id,expiredId,randomUUID(),"f".repeat(64)]);
      await expireClient.query(`INSERT INTO group_settlement_bilateral_sources
        (proposal_id,group_id,cycle_id,party_low,party_high,obligation_id,
         debtor_id,creditor_id,occurred_on,expense_version,original_minor,
         confirmed_cash_minor,pending_cash_minor,confirmed_setoff_minor,
         pending_setoff_minor,available_before_minor,proposed_minor,
         available_after_minor)
        SELECT $2,group_id,cycle_id,party_low,party_high,obligation_id,
         debtor_id,creditor_id,occurred_on,expense_version,original_minor,
         confirmed_cash_minor,pending_cash_minor,confirmed_setoff_minor,
         pending_setoff_minor,available_before_minor,proposed_minor,
         available_after_minor
        FROM group_settlement_bilateral_sources WHERE proposal_id=$1`,
        [sixth.id,expiredId]);
      await expireClient.query(`UPDATE group_settlement_bilateral_heads
        SET version=7,current_proposal_id=$2
        WHERE group_id=$1 AND cycle_id=$3`,[bnGroup,expiredId,bnCycle]);
      await expireClient.query("COMMIT");
    }catch(e){await expireClient.query("ROLLBACK");throw e;}
    finally{expireClient.release();}
    const expiredUrl=bnDecisionUrl(expiredId);
    const expiredGet=await expenseRequest("GET",expiredUrl,undefined,jar);
    assert.equal(expiredGet.response.status,200);
    assert.equal(expiredGet.body.status,"expired");
    // A direct SQL client cannot disguise expired consent as a timely
    // signatory rejection, nor revoke a historical signature after expiry.
    for(const action of ["reject","revoke"]){
      await assert.rejects(pool.query(`
        INSERT INTO group_settlement_bilateral_decision_events
          (id,proposal_id,group_id,cycle_id,party_low,party_high,
           actor_id,event_type,request_key,request_digest,source_fingerprint)
        SELECT $2,p.id,p.group_id,p.cycle_id,p.party_low,p.party_high,
          $3,$4,$5,$6,p.source_fingerprint
        FROM group_settlement_bilateral_proposals p WHERE p.id=$1`,
        [expiredId,randomUUID(),registered.user.id,action,
         randomUUID(),"a".repeat(64)]),
        /BN-003 (rejection|revocation) denied for stale or expired state/,
        "expired proposal cannot accept direct SQL signatory decision");
    }
    assert.equal((await pool.query(`SELECT count(*)::int AS n
      FROM group_settlement_bilateral_decision_events WHERE proposal_id=$1`,
      [expiredId])).rows[0].n,0,
      "attempted expired decisions leave no audit or finance mutations");
    assert.equal(expiredGet.body.approvalCount,0);
    const expiredPost=await expenseRequest("POST",expiredUrl,
      decisionBody("approve",7,sixth.sourceFingerprint),jar);
    assert.equal(expiredPost.response.status,409,
      "expiry must be committed before rejecting a late approval");
    assert.equal((await pool.query(`SELECT count(*)::int AS n FROM
      group_settlement_bilateral_decision_events
      WHERE proposal_id=$1 AND event_type='expired'`,
      [expiredId])).rows[0].n,1);
    assert.equal((await expenseRequest("POST",expiredUrl,
      decisionBody("approve",7,sixth.sourceFingerprint),otherJar))
      .response.status,409);
    assert.equal((await pool.query(`SELECT count(*)::int AS n FROM
      group_settlement_bilateral_decision_events
      WHERE proposal_id=$1 AND event_type='expired'`,
      [expiredId])).rows[0].n,1,"retry must not duplicate expiry event");
    // Opt-out and membership revocation are FINANCIAL CONSENT revocations,
    // not merely transient UI disabled flags. They cannot be resurrected by
    // re-enabling netting or the same member rejoining.
    const v8Preview=(await expenseRequest("GET",bnReadUrl,undefined,jar)).body;
    assert.equal(v8Preview.currentVersion,7);
    const v8Creation=await expenseRequest("POST",bnProposalUrl,
      bnPayload(7,randomUUID(),v8Preview.fingerprint),jar);
    assert.equal(v8Creation.response.status,201,JSON.stringify(v8Creation.body));
    const v8=v8Creation.body.proposal,v8Url=bnDecisionUrl(v8.id);
    assert.equal((await expenseRequest("GET",v8Url,undefined,jar))
      .body.status,"pending");
    await pool.query(`UPDATE group_members
      SET status='left',left_at=clock_timestamp()
      WHERE group_id=$1 AND user_id=$2`,[bnGroup,thirdUser.id]);
    assert.equal((await expenseRequest("GET",v8Url,undefined,jar))
      .body.status,"pending",
      "unrelated third-party departure cannot invalidate A/B proposal");
    assert.equal((await expenseRequest("PATCH",bnSetting,
      config(4,false,false),jar)).response.status,200);
    assert.equal((await pool.query(`SELECT count(*)::int AS n
      FROM group_settlement_bilateral_decision_events
      WHERE proposal_id=$1 AND event_type='invalidated'`,
      [v8.id])).rows[0].n,1,
      "owner opt-out durably invalidates current pair consent");
    assert.equal((await expenseRequest("PATCH",bnSetting,
      config(5,true,true),jar)).response.status,200);
    assert.equal((await expenseRequest("GET",v8Url,undefined,jar))
      .body.status,"invalidated",
      "opt-out/re-enable cannot resurrect previous consent");
    const v9Creation=await expenseRequest("POST",bnProposalUrl,
      bnPayload(8,randomUUID(),v8.sourceFingerprint),jar);
    assert.equal(v9Creation.response.status,201,JSON.stringify(v9Creation.body));
    const v9=v9Creation.body.proposal,v9Url=bnDecisionUrl(v9.id);
    assert.equal((await expenseRequest("GET",v9Url,undefined,jar))
      .body.status,"pending");
    await pool.query(`UPDATE group_members
      SET status='left',left_at=clock_timestamp()
      WHERE group_id=$1 AND user_id=$2`,[bnGroup,otherUser.id]);
    assert.equal((await pool.query(`SELECT count(*)::int AS n
      FROM group_settlement_bilateral_decision_events
      WHERE proposal_id=$1 AND event_type='invalidated'`,
      [v9.id])).rows[0].n,1,
      "signatory departure invalidates pending/approved consent at SQL commit");
    await pool.query(`UPDATE group_members SET status='active',
      left_at=NULL,rejoined_at=clock_timestamp()
      WHERE group_id=$1 AND user_id=$2`,[bnGroup,otherUser.id]);
    assert.equal((await expenseRequest("GET",v9Url,undefined,jar))
      .body.status,"invalidated",
      "rejoining cannot restore old signed documents");
    const v10Creation=await expenseRequest("POST",bnProposalUrl,
      bnPayload(9,randomUUID(),v9.sourceFingerprint),jar);
    assert.equal(v10Creation.response.status,201,JSON.stringify(v10Creation.body));
    const v10=v10Creation.body.proposal;
    await pool.query(`UPDATE groups SET archived_at=clock_timestamp()
      WHERE id=$1`,[bnGroup]);
    assert.equal((await pool.query(`SELECT count(*)::int AS n
      FROM group_settlement_bilateral_decision_events
      WHERE proposal_id=$1 AND event_type='invalidated'`,
      [v10.id])).rows[0].n,1,
      "group archive invalidates consent even through SQL bypass");
    assert.equal((await pool.query(`SELECT count(*)::int AS n FROM
      group_settlement_bilateral_decision_events
      WHERE proposal_id=$1 AND event_type='approve'`,[v10.id])).rows[0].n,0);

    // No proposal approval/revocation/rejection may modify actual cash.
    assert.equal((await pool.query(`SELECT count(*)::int AS n FROM
      settlement_allocations WHERE group_id=$1`,[bnGroup])).rows[0].n,3);
    assert.equal((await pool.query(`SELECT count(*)::int AS n FROM
      group_settlement_bilateral_decision_events WHERE proposal_id=$1`,
      [bnThird.id])).rows[0].n,3);

    // BN-004 — STRICT disposable PostgreSQL noncash application.
    // Previous BN-003 fixtures deliberately archived this group. Restore
    // activity and create a NEW version with two fresh independent approvals.
    await pool.query("UPDATE groups SET archived_at=NULL WHERE id=$1",[bnGroup]);
    await pool.query(`UPDATE group_members SET status='active',
      left_at=NULL,rejoined_at=clock_timestamp()
      WHERE group_id=$1 AND user_id=$2`,[bnGroup,thirdUser.id]);
    const appPreview=(await expenseRequest("GET",bnReadUrl,undefined,jar)).body;
    assert.equal(appPreview.currentVersion,10);
    const appCreated=await expenseRequest("POST",bnProposalUrl,
      bnPayload(10,randomUUID(),appPreview.fingerprint),jar);
    assert.equal(appCreated.response.status,201,JSON.stringify(appCreated.body));
    const appProposal=appCreated.body.proposal;
    assert.equal(appProposal.version,11);
    const appDecisions=bnDecisionUrl(appProposal.id);
    const applyUrl=`${bnProposalUrl}/${appProposal.id}/applications`;
    const applyBody=(key=randomUUID())=>({
      expectedVersion:11,expectedFingerprint:appProposal.sourceFingerprint,
      requestKey:key,
    });
    const appBefore=(await pool.query(`SELECT
        (SELECT count(*)::int FROM settlements WHERE group_id=$1) AS cash_count,
        (SELECT count(*)::int FROM settlement_allocations WHERE group_id=$1) AS allocation_count,
        (SELECT count(*)::int FROM group_settlement_bilateral_applications WHERE group_id=$1) AS application_count`,
      [bnGroup])).rows[0];
    assert.equal(appBefore.application_count,0);
    assert.equal((await expenseRequest("GET",applyUrl,undefined,new Map()))
      .response.status,401);
    assert.equal((await expenseRequest("GET",applyUrl,undefined,thirdJar))
      .response.status,403);
    assert.equal((await expenseRequest("POST",applyUrl,applyBody(),thirdJar))
      .response.status,403,"unrelated group admin cannot apply");
    assert.equal((await expenseRequest("POST",applyUrl,
      {...applyBody(),appliedBy:registered.user.id},jar)).response.status,400,
      "client cannot forge an application identity");
    assert.equal((await expenseRequest("POST",applyUrl,applyBody(),jar))
      .response.status,409,"no approval is not enough");

    const oneApproval=await expenseRequest("POST",appDecisions,
      decisionBody("approve",11,appProposal.sourceFingerprint),jar);
    assert.equal(oneApproval.response.status,201);
    assert.equal((await expenseRequest("POST",applyUrl,applyBody(),jar))
      .response.status,409,"one signatory approval cannot apply");
    // PostgreSQL also refuses a direct SQL bypass with just one signature.
    await assert.rejects(pool.query(`
      INSERT INTO group_settlement_bilateral_applications
        (id,proposal_id,group_id,cycle_id,party_low,party_high,
         applied_by,request_key,request_digest,source_fingerprint,
         snapshot_fingerprint,proposal_version,offset_minor)
      SELECT $2,p.id,p.group_id,p.cycle_id,p.party_low,p.party_high,
        $3,$4,$5,p.source_fingerprint,p.snapshot_fingerprint,
        p.version,p.offset_minor
      FROM group_settlement_bilateral_proposals p WHERE p.id=$1`,
      [appProposal.id,randomUUID(),registered.user.id,randomUUID(),"a".repeat(64)]),
      /BN-004 requires two live/);

    const twoApprovals=await expenseRequest("POST",appDecisions,
      decisionBody("approve",11,appProposal.sourceFingerprint),otherJar);
    assert.equal(twoApprovals.response.status,201);
    assert.equal(twoApprovals.body.status,"agreed");
    assert.equal((await expenseRequest("POST",applyUrl,{
      ...applyBody(),expectedFingerprint:"a".repeat(64),
    },jar)).response.status,409,"incorrect source fingerprint");
    assert.equal((await expenseRequest("POST",applyUrl,{
      ...applyBody(),expectedVersion:10,
    },jar)).response.status,409,"stale proposal version");

    // A fabricated partial application that posts only ONE direction must
    // rollback at deferred COMMIT. This cannot persist unbalanced money.
    const partial=await pool.connect();
    try{
      await partial.query("BEGIN");
      const partialId=randomUUID();
      await partial.query(`
        INSERT INTO group_settlement_bilateral_applications
          (id,proposal_id,group_id,cycle_id,party_low,party_high,
           applied_by,request_key,request_digest,source_fingerprint,
           snapshot_fingerprint,proposal_version,offset_minor)
        SELECT $2,p.id,p.group_id,p.cycle_id,p.party_low,p.party_high,
          $3,$4,$5,p.source_fingerprint,p.snapshot_fingerprint,
          p.version,p.offset_minor
        FROM group_settlement_bilateral_proposals p WHERE p.id=$1`,
        [appProposal.id,partialId,registered.user.id,randomUUID(),"b".repeat(64)]);
      await partial.query(`
        INSERT INTO group_settlement_bilateral_application_allocations
          (application_id,proposal_id,group_id,cycle_id,obligation_id,
           debtor_id,creditor_id,amount_minor)
        SELECT $1,proposal_id,group_id,cycle_id,obligation_id,
          debtor_id,creditor_id,proposed_minor
        FROM group_settlement_bilateral_sources
        WHERE proposal_id=$2 AND proposed_minor>0
        ORDER BY occurred_on,obligation_id LIMIT 1`,[partialId,appProposal.id]);
      await assert.rejects(partial.query(
        "SET CONSTRAINTS bn004_conservation_on_commit IMMEDIATE"),
        /BN-004 both-direction amounts and source counts must conserve/);
    } finally {await partial.query("ROLLBACK");partial.release();}
    assert.equal((await pool.query(`SELECT count(*)::int AS n
      FROM group_settlement_bilateral_applications WHERE proposal_id=$1`,
      [appProposal.id])).rows[0].n,0,"failed one-sided application rolled back");

    const requestKey=randomUUID();
    const concurrent=await Promise.all([
      expenseRequest("POST",applyUrl,applyBody(requestKey),jar),
      expenseRequest("POST",applyUrl,applyBody(requestKey),jar),
    ]);
    assert.deepEqual(concurrent.map(r=>r.response.status).sort(),[200,201],
      "same-key concurrent apply must produce just one document");
    const applied=concurrent[0].body.application;
    assert.equal(applied.id,concurrent[1].body.application.id);
    assert.equal(applied.noncash,true);
    assert.equal(applied.cashTransferredMinor,"0");
    assert.equal(applied.offsetMinor,appProposal.offsetMinor);
    const appliedGet=await expenseRequest("GET",applyUrl,undefined,otherJar);
    assert.equal(appliedGet.response.status,200);
    assert.equal(appliedGet.body.application.id,applied.id);
    // SC-008: real Server Component + Better Auth + PG17 rendered on
    // mobile-responsive routes. The financial engine remains OFF, and
    // all displayed sums are LIVE original BN-005 source totals rather
    // than a 50-row list sum.
    const sc008ListUrl=`${origin}/groups/${bnGroup}/cycles`;
    const sc008DetailUrl=`${sc008ListUrl}/${bnCycle}`;
    const sc008Page=async(url,cookies=jar)=>{
      const response=await fetch(url,{redirect:"manual",
        headers:cookies.size?{cookie:cookieHeader(cookies)}:{},
        signal:AbortSignal.timeout(20000)});
      // React server rendering can insert HTML text-boundary comments.
      // Assert visible words/numbers rather than fragile comment markers.
      return {response,html:(await response.text()).replace(/<!--\s*-->/g,"")};
    };
    const sc008Anon=await sc008Page(sc008ListUrl,new Map());
    assert.ok([200,307].includes(sc008Anon.response.status));
    if(sc008Anon.response.status===200){
      assert.doesNotMatch(sc008Anon.html,/Công nợ gốc trong kỳ|Quyết toán theo kỳ.*Kỳ/, 
        "unauthenticated cycle listing must never leak ledger information");
      assert.match(sc008Anon.html,/NEXT_REDIRECT|http-equiv|__next-page-redirect/);
    }else{
      assert.equal(new URL(sc008Anon.response.headers.get("location"),origin)
        .pathname,"/sign-in");
    }
    const sc008List=await sc008Page(sc008ListUrl);
    assert.equal(sc008List.response.status,200,sc008List.html.slice(0,150));
    assert.match(sc008List.html,/Các kỳ đã ghi nhận/);
    assert.match(sc008List.html,/Chế độ xem trước/);
    assert.match(sc008List.html,/Đã khóa sổ/);
    const sc008OriginalCount=(await pool.query(`
      SELECT count(*)::int AS n FROM group_settlement_cycle_snapshot_obligations
      WHERE group_id=$1 AND cycle_id=$2`,[bnGroup,bnCycle])).rows[0].n;
    assert.ok(sc008OriginalCount>50,
      "SC-008 needs a >50-source fixture to detect a paginated money bug");
    const sc008Source=await sc008Page(sc008DetailUrl);
    assert.equal(sc008Source.response.status,200,sc008Source.html.slice(0,150));
    assert.match(sc008Source.html,/Công nợ gốc trong kỳ/);
    assert.match(sc008Source.html,
      new RegExp(`Tổng hợp từ toàn bộ ${sc008OriginalCount} nghĩa vụ gốc`));
    assert.match(sc008Source.html,/Tiền mặt đã xác nhận/);
    assert.match(sc008Source.html,/Đã bù trừ phi tiền mặt/);
    assert.match(sc008Source.html,/Tiền mặt chờ xác nhận/);
    assert.match(sc008Source.html,/Chưa phát hành giao dịch quyết toán/);
    assert.match(sc008Source.html,/Phân trang nguồn công nợ/);
    const sc008PageTwo=await sc008Page(sc008DetailUrl+"?page=2");
    assert.equal(sc008PageTwo.response.status,200);
    assert.match(sc008PageTwo.html,/Trang 2\//);
    assert.match(sc008PageTwo.html,
      new RegExp(`Tổng hợp từ toàn bộ ${sc008OriginalCount} nghĩa vụ gốc`),
      "paging must never alter grand totals");
    const sc008Live=(await pool.query(`
      SELECT COALESCE(sum(b.original_minor),0)::text AS original,
        COALESCE(sum(b.confirmed_cash_minor),0)::text AS cash,
        COALESCE(sum(b.confirmed_setoff_minor),0)::text AS setoff,
        COALESCE(sum(b.pending_cash_minor),0)::text AS pending
      FROM group_settlement_cycle_snapshot_obligations src
      JOIN bn005_obligation_balances b ON b.obligation_id=src.obligation_id
      WHERE src.group_id=$1 AND src.cycle_id=$2`,[bnGroup,bnCycle])).rows[0];
    const vi=(n)=>new Intl.NumberFormat("vi-VN").format(BigInt(n));
    assert.ok(BigInt(sc008Live.setoff)>0n,"BN-004 committed setoff is visible in UI");
    for(const amount of Object.values(sc008Live))
      assert.ok(sc008Source.html.includes(vi(amount)),
        `Rendered UI must include FULL ORIGINAL source amount ${amount}`);

    assert.equal((await expenseRequest("POST",applyUrl,applyBody(),otherJar))
      .response.status,409,"second party cannot double apply the same pair");
    assert.equal((await expenseRequest("POST",applyUrl,applyBody(requestKey),jar))
      .response.status,200,"lost HTTP response replay returns original proof");
    assert.equal((await expenseRequest("POST",applyUrl,
      {...applyBody(requestKey),expectedVersion:12},jar)).response.status,409,
      "request key cannot authorize a different proposal version");
    assert.equal((await expenseRequest("POST",applyUrl,
      {...applyBody(requestKey),expectedFingerprint:"a".repeat(64)},jar))
      .response.status,409,"request key cannot authorize different fingerprint");

    const balanced=(await pool.query(`
      SELECT a.debtor_id,a.creditor_id,
         sum(a.amount_minor)::text AS total,count(*)::int AS n
      FROM group_settlement_bilateral_application_allocations a
      WHERE a.application_id=$1
      GROUP BY a.debtor_id,a.creditor_id`,[applied.id])).rows;
    assert.equal(balanced.length,2,"exactly two opposite directions posted");
    assert.equal(balanced[0].total,appProposal.offsetMinor);
    assert.equal(balanced[1].total,appProposal.offsetMinor);
    const exactProof=await pool.query(`
      SELECT count(*)::int AS n FROM group_settlement_bilateral_application_allocations a
      JOIN group_settlement_bilateral_sources s
        ON s.proposal_id=a.proposal_id AND s.obligation_id=a.obligation_id
      WHERE a.application_id=$1 AND a.amount_minor=s.proposed_minor
        AND a.debtor_id=s.debtor_id AND a.creditor_id=s.creditor_id`,[applied.id]);
    assert.equal(exactProof.rows[0].n,
      (await pool.query(`SELECT allocation_count FROM group_settlement_bilateral_proposals
        WHERE id=$1`,[appProposal.id])).rows[0].allocation_count);
    const appAfter=(await pool.query(`SELECT
        (SELECT count(*)::int FROM settlements WHERE group_id=$1) AS cash_count,
        (SELECT count(*)::int FROM settlement_allocations WHERE group_id=$1) AS allocation_count,
        (SELECT count(*)::int FROM group_settlement_bilateral_applications WHERE group_id=$1) AS application_count`,
      [bnGroup])).rows[0];
    assert.equal(appAfter.cash_count,appBefore.cash_count,"noncash may not insert cash settlement");
    assert.equal(appAfter.allocation_count,appBefore.allocation_count,
      "noncash may not alter original cash allocations");
    assert.equal(appAfter.application_count,1);
    await assert.rejects(pool.query(`
      UPDATE group_settlement_bilateral_applications SET offset_minor=1
      WHERE id=$1`,[applied.id]),/append-only/);
    await assert.rejects(pool.query(`
      DELETE FROM group_settlement_bilateral_applications WHERE id=$1`,
      [applied.id]),/append-only/);
    await assert.rejects(pool.query(`
      UPDATE group_settlement_bilateral_application_allocations
      SET amount_minor=1 WHERE application_id=$1`,[applied.id]),/append-only/);
    await assert.rejects(pool.query(`
      DELETE FROM group_settlement_bilateral_application_allocations
      WHERE application_id=$1`,[applied.id]),/append-only/);
    assert.equal((await expenseRequest("POST",appDecisions,
      decisionBody("revoke",11,appProposal.sourceFingerprint),jar))
      .response.status,409,"applied agreement cannot be revoked");
    assert.equal((await pool.query(`SELECT count(*)::int AS n
      FROM group_settlement_bilateral_decision_events
      WHERE proposal_id=$1 AND event_type='revoke'`,[appProposal.id])).rows[0].n,0);
    // BN-005: every balance and user-facing reader must now recognize
    // immutable NONCASH discharge but preserve original cash records.
    const totalsAfter=await pool.query(`
      SELECT sum(b.confirmed_setoff_minor)::text AS setoff,
        sum(b.confirmed_cash_minor)::text AS cash,
        sum(b.pending_cash_minor)::text AS pending,
        sum(b.outstanding_minor)::text AS outstanding,
        sum(b.available_minor)::text AS available,
        count(*)::int AS sources
      FROM bn005_obligation_balances b
      JOIN obligations o ON o.id=b.obligation_id
      WHERE o.group_id=$1 AND o.voided_at IS NULL`,[bnGroup]);
    const bt=totalsAfter.rows[0];
    assert.equal(bt.sources,122);
    assert.equal(bt.setoff,(2n*BigInt(appProposal.offsetMinor)).toString(),
      "one applied document must discharge equal total money on BOTH sides");
    assert.ok(BigInt(bt.outstanding)>=0n && BigInt(bt.available)>=0n,
      "money cannot become negative");
    assert.ok(BigInt(bt.outstanding)>=BigInt(bt.available),
      "pending cash must remain reserved, not treated as confirmed");
    const brokenSources=await pool.query(`
      SELECT b.obligation_id FROM bn005_obligation_balances b
      JOIN obligations o ON o.id=b.obligation_id
      WHERE o.group_id=$1 AND (b.outstanding_minor<0 OR b.available_minor<0
        OR b.original_minor<>b.confirmed_cash_minor
           +b.confirmed_setoff_minor+b.outstanding_minor
        OR b.outstanding_minor<>b.pending_cash_minor+b.available_minor)`,
      [bnGroup]);
    assert.equal(brokenSources.rowCount,0,
      "per-obligation conservation must hold, never only aggregate");
    const grouped=await expenseRequest("GET",
      `${origin}/api/groups/${bnGroup}/debts`,undefined,jar);
    assert.equal(grouped.response.status,200,JSON.stringify(grouped.body));
    const rows=grouped.body.debts;
    assert.equal(rows.length,122);
    const debtSetoff=rows.reduce((n,x)=>n+BigInt(x.confirmedSetoffMinor),0n);
    assert.equal(debtSetoff.toString(),bt.setoff);
    assert.equal(rows.reduce((n,x)=>n+BigInt(x.outstandingMinor),0n).toString(),
      bt.outstanding);
    const personalAfter=await expenseRequest("GET",
      `${origin}/api/debts`,undefined,jar);
    assert.equal(personalAfter.response.status,200);
    const pairPersonal=personalAfter.body.debts.filter(x=>x.groupId===bnGroup);
    assert.equal(pairPersonal.reduce((n,x)=>n+BigInt(x.amountMinor),0n),
      BigInt(bt.outstanding),"personal multi-group report must include noncash discharge");
    const withSetoff=rows.find(x=>BigInt(x.confirmedSetoffMinor)>0n);
    assert.ok(withSetoff);
    const itemDetail=await expenseRequest("GET",
      `${origin}/api/groups/${bnGroup}/debts/${withSetoff.id}`,
      undefined,otherJar);
    assert.equal(itemDetail.response.status,200);
    assert.equal(itemDetail.body.debt.confirmedSetoffMinor,
      withSetoff.confirmedSetoffMinor);
    assert.equal(itemDetail.body.setoffs.length,1);
    assert.equal(itemDetail.body.setoffs[0].applicationId,applied.id);
    assert.equal(itemDetail.body.setoffs[0].amountMinor,
      withSetoff.confirmedSetoffMinor);
    const forwardDebt=rows.find(r=>r.expenseId===bnForward.body.id);
    assert.ok(forwardDebt&&BigInt(forwardDebt.confirmedSetoffMinor)>0n,
      "original invoice must expose exact noncash discharge");
    const invoice=await expenseRequest("GET",
      `${bnExpenses}/${bnForward.body.id}`,undefined,jar);
    assert.equal(invoice.response.status,200,JSON.stringify(invoice.body));
    const progress=invoice.body.expense??invoice.body;
    assert.equal(progress.remainingMinor,forwardDebt.outstandingMinor);
    assert.equal(progress.confirmedSetoffMinor,forwardDebt.confirmedSetoffMinor);
    assert.equal(BigInt(progress.confirmedMinor),
      BigInt(progress.confirmedCashMinor)+BigInt(progress.confirmedSetoffMinor));
    const originalHistory=await pool.query(`
      SELECT count(*)::int AS n FROM settlement_allocations a
      WHERE a.group_id=$1`,[bnGroup]);
    assert.equal(originalHistory.rows[0].n,appBefore.allocation_count,
      "bù trừ KHÔNG được tạo thêm giao dịch tiền mặt");

    // A fully discharged original obligation is NO LONGER available for
    // another manual cash report. Direct SQL bypass must also roll back.
    const fully=await pool.query(`
      SELECT o.id AS obligation_id,o.debtor_id,o.creditor_id,o.expense_id,
        b.confirmed_setoff_minor::text AS setoff
      FROM obligations o
      JOIN bn005_obligation_balances b ON b.obligation_id=o.id
      JOIN expenses e ON e.id=o.expense_id
      WHERE o.group_id=$1 AND o.voided_at IS NULL
        AND b.confirmed_setoff_minor>0 AND b.available_minor=0
        AND b.outstanding_minor=0 AND e.completed_at IS NULL
      ORDER BY o.id LIMIT 1`,[bnGroup]);
    assert.equal(fully.rowCount,1,"fixture has a noncash-settled invoice");
    const full=fully.rows[0];
    const debtorJar=full.debtor_id===registered.user.id?jar:otherJar;
    const creditorJar=full.creditor_id===registered.user.id?jar:otherJar;
    assert.equal((await expenseRequest("POST",bnCash,{
      requestKey:randomUUID(),
      allocations:[{obligationId:full.obligation_id,amountMinor:"1"}],
    },debtorJar)).response.status,409,
      "a 1-VND manual settlement MUST NOT spend discharged money again");
    const rawClient=await pool.connect();
    try{
      await rawClient.query("BEGIN");
      const sid=randomUUID();
      await rawClient.query(`INSERT INTO settlements
        (id,group_id,debtor_id,creditor_id,initiated_by,status,
         amount_minor,request_key,request_fingerprint,note)
        VALUES($1,$2,$3,$4,$3,'pending',1,$5,$6,'BN005 bypass')`,
        [sid,bnGroup,full.debtor_id,full.creditor_id,
          randomUUID(),"a".repeat(64)]);
      await rawClient.query(`INSERT INTO settlement_allocations
        (settlement_id,obligation_id,group_id,debtor_id,creditor_id,amount_minor)
        VALUES($1,$2,$3,$4,$5,1)`,
        [sid,full.obligation_id,bnGroup,full.debtor_id,full.creditor_id]);
      await assert.rejects(rawClient.query("COMMIT"),
        /BN-005 cash exceeds live debt/,
        "SQL bypass also must not overbook applied setoff");
    }finally{await rawClient.query("ROLLBACK");rawClient.release();}

    // Creator-only completion after NONCASH discharge, without cash
    // confirmation. The non-creator must never be able to finalize it.
    assert.equal((await expenseRequest("POST",
      `${bnExpenses}/${full.expense_id}/complete`,
      {expectedVersion:1},debtorJar)).response.status,403);
    const completedSetoff=await expenseRequest("POST",
      `${bnExpenses}/${full.expense_id}/complete`,
      {expectedVersion:1},creditorJar);
    assert.equal(completedSetoff.response.status,200,
      JSON.stringify(completedSetoff.body));
    assert.equal((await pool.query(`SELECT completed_by
      FROM expenses WHERE id=$1`,[full.expense_id])).rows[0].completed_by,
      full.creditor_id);

    // Do not permit a member with residual debt to leave, nor archive a
    // group with remaining obligations. The checks are live, not snapshots.
    const exit=await expenseRequest("GET",
      `${origin}/api/groups/${bnGroup}/membership/leave`,undefined,otherJar);
    assert.equal(exit.response.status,200);
    assert.equal(exit.body.eligibility.canLeave,false);
    assert.equal(BigInt(exit.body.eligibility.toPayMinor)+
      BigInt(exit.body.eligibility.toReceiveMinor),BigInt(bt.outstanding));
    assert.equal((await expenseRequest("POST",
      `${origin}/api/groups/${bnGroup}/archive`,
      {confirmation:"BN002 two-way"},jar)).response.status,409);
    const pairRepayments=await expenseRequest("GET",
      `${bnCycleApi}/${bnCycle}/repayments`,undefined,jar);
    assert.equal(pairRepayments.response.status,200,
      JSON.stringify(pairRepayments.body));
    assert.equal(pairRepayments.body.pairs.reduce((n,x)=>
      n+BigInt(x.availableMinor),0n),BigInt(bt.available),
      "SC-005 available cannot include already applied setoff");
    const reProposal=await expenseRequest("POST",bnProposalUrl,
      bnPayload(11,randomUUID(),
        (await expenseRequest("GET",bnReadUrl,undefined,jar)).body.fingerprint),
      jar);
    assert.equal(reProposal.response.status,409,
      "one pair/cycle cannot re-bill discharged source even if balances change");
    // Ordinary one-direction cash remains compatible with the remaining
    // AVAILABLE portion after noncash set-off. Pending is NOT confirmed;
    // cancellation releases the reservation; counterpart confirmation
    // is still required for a successful cash settlement.
    const residual=await pool.query(`
      SELECT o.id,o.debtor_id,o.creditor_id,
        b.available_minor::text AS available,
        b.outstanding_minor::text AS outstanding,
        b.confirmed_setoff_minor::text AS setoff,
        b.confirmed_cash_minor::text AS cash
      FROM obligations o
      JOIN bn005_obligation_balances b ON b.obligation_id=o.id
      WHERE o.group_id=$1 AND b.available_minor>0
      ORDER BY b.confirmed_setoff_minor DESC,o.id LIMIT 1`,[bnGroup]);
    assert.equal(residual.rowCount,1);
    const left=residual.rows[0],amount="1000";
    assert.ok(BigInt(left.available)>=BigInt(amount));
    const cashDebtor=left.debtor_id===registered.user.id?jar:otherJar;
    const cashOther=left.creditor_id===registered.user.id?jar:otherJar;
    const pendingLeft=await expenseRequest("POST",bnCash,{
      requestKey:randomUUID(),allocations:[
        {obligationId:left.id,amountMinor:amount}],
    },cashDebtor);
    assert.equal(pendingLeft.response.status,201,JSON.stringify(pendingLeft.body));
    const afterPending=(await pool.query(`
      SELECT confirmed_setoff_minor::text AS setoff,
        outstanding_minor::text AS outstanding,
        available_minor::text AS available,pending_cash_minor::text AS pending
      FROM bn005_obligation_balances WHERE obligation_id=$1`,[left.id])).rows[0];
    assert.equal(afterPending.setoff,left.setoff);
    assert.equal(afterPending.outstanding,left.outstanding,
      "pending cash is a reservation, NOT debt discharge");
    assert.equal(BigInt(afterPending.available),BigInt(left.available)-1000n);
    const cancelled=await expenseRequest("PATCH",
      `${bnCash}/${pendingLeft.body.id}`,{action:"cancel"},cashDebtor);
    assert.equal(cancelled.response.status,200);
    const released=(await pool.query(`
      SELECT available_minor::text AS available,
        confirmed_setoff_minor::text AS setoff
      FROM bn005_obligation_balances WHERE obligation_id=$1`,
      [left.id])).rows[0];
    assert.equal(released.available,left.available);
    assert.equal(released.setoff,left.setoff);
    const validCash=await expenseRequest("POST",bnCash,{
      requestKey:randomUUID(),allocations:[
        {obligationId:left.id,amountMinor:amount}],
    },cashDebtor);
    assert.equal(validCash.response.status,201);
    assert.equal((await expenseRequest("PATCH",`${bnCash}/${validCash.body.id}`,
      {action:"confirm"},cashOther)).response.status,200,
      "only the existing two-person cash confirmation discharges the residual");
    const confirmedLeft=(await pool.query(`
      SELECT confirmed_setoff_minor::text AS setoff,
        confirmed_cash_minor::text AS cash,
        outstanding_minor::text AS outstanding
      FROM bn005_obligation_balances WHERE obligation_id=$1`,
      [left.id])).rows[0];
    assert.equal(confirmedLeft.setoff,left.setoff,
      "immutable noncash history never changes when real cash is confirmed");
    assert.equal(BigInt(confirmedLeft.cash),BigInt(left.cash)+1000n);
    assert.equal(BigInt(confirmedLeft.outstanding),BigInt(left.outstanding)-1000n);



    // BN-006: the residual is a distinct, ordinary CASH request linked to
    // this already-applied noncash proof. Only the two REAL counterparties
    // can initiate it, and only the other can confirm it. Never auto-pay.
    const bn006Url=`${bnCycleApi}/${bnCycle}/bilateral-applications/${applied.id}/residual`;
    assert.equal((await expenseRequest("GET",bn006Url,undefined,new Map()))
      .response.status,401);
    assert.equal((await expenseRequest("GET",bn006Url,undefined,thirdJar))
      .response.status,403);
    assert.equal((await expenseRequest("POST",bn006Url,{
      expectedCycleVersion:3,requestKey:randomUUID(),
      expectedFingerprint:"a".repeat(64),
    },thirdJar)).response.status,403);
    const bn006Preview=(await expenseRequest("GET",bn006Url,undefined,jar));
    assert.equal(bn006Preview.response.status,200,JSON.stringify(bn006Preview.body));
    const firstPreview=bn006Preview.body.preview;
    assert.equal(firstPreview.status,"ready");
    assert.equal(firstPreview.offsetMinor,appProposal.offsetMinor);
    assert.equal(firstPreview.pendingCashMinor,"0");
    assert.equal(firstPreview.financialEngineEnabled,false);
    assert.equal(bn006Preview.body.writable,true,"disposable PG17 ONLY");
    assert.equal(firstPreview.remainingLowToHighMinor==="0"||
      firstPreview.remainingHighToLowMinor==="0",true);
    const originalBN004Count=(await pool.query(`SELECT count(*)::int AS n
      FROM group_settlement_bilateral_application_allocations
      WHERE application_id=$1`,[applied.id])).rows[0].n;
    const bn006Body=(fingerprint,key=randomUUID(),note="BN006 residual")=>({
      expectedCycleVersion:3,requestKey:key,
      expectedFingerprint:fingerprint,note,
    });
    assert.equal((await expenseRequest("POST",bn006Url,{
      ...bn006Body(firstPreview.fingerprint),amountMinor:"1",
    },jar)).response.status,400,"client cannot supply money or allocations");
    assert.equal((await expenseRequest("POST",bn006Url,{
      ...bn006Body(firstPreview.fingerprint),debtorId:thirdUser.id,
    },jar)).response.status,400,"client cannot impersonate a pair member");
    assert.equal((await expenseRequest("POST",bn006Url,
      bn006Body("a".repeat(64)),jar)).response.status,409,
      "stale/fabricated original source fingerprint denied");

    // Existing independent pending CASH invalidates net-residual action:
    // do not collect a new transfer while another is awaiting confirmation.
    const bn006Source=(await pool.query(`SELECT o.id
      FROM obligations o JOIN bn005_obligation_balances b ON b.obligation_id=o.id
      WHERE o.group_id=$1 AND o.debtor_id=$2 AND o.creditor_id=$3
        AND b.available_minor>0 ORDER BY o.id LIMIT 1`,
      [bnGroup,firstPreview.debtorId,firstPreview.creditorId])).rows[0];
    const cashInitiator=firstPreview.debtorId===registered.user.id?jar:otherJar;
    const cashCounterparty=firstPreview.creditorId===registered.user.id?jar:otherJar;
    assert.ok(bn006Source);
    const externalPending=await expenseRequest("POST",bnCash,{
      requestKey:randomUUID(),allocations:[
        {obligationId:bn006Source.id,amountMinor:"1"}],
    },cashInitiator);
    assert.equal(externalPending.response.status,201);
    const blocked006=await expenseRequest("GET",bn006Url,undefined,jar);
    assert.equal(blocked006.body.preview.status,"blocked");
    assert.equal(blocked006.body.preview.pendingCashMinor,"1");
    assert.equal((await expenseRequest("POST",bn006Url,
      bn006Body(blocked006.body.preview.fingerprint),jar))
      .response.status,409,"cannot settle ambiguous pending cash");
    assert.equal((await expenseRequest("PATCH",
      `${bnCash}/${externalPending.body.id}`,{action:"cancel"},cashInitiator))
      .response.status,200);
    const postHold=(await expenseRequest("GET",bn006Url,undefined,jar)).body.preview;
    assert.equal(postHold.status,"ready");
    assert.equal(postHold.amountMinor,firstPreview.amountMinor,
      "cancelled reservation does not reduce cash residual");

    // Concurrent SAME request-key attempts must atomically publish ONE
    // pending settlement, matching one append-only BN-006 proof.
    const bn006Key=randomUUID();
    const parallel=await Promise.all([
      expenseRequest("POST",bn006Url,bn006Body(postHold.fingerprint,bn006Key),jar),
      expenseRequest("POST",bn006Url,bn006Body(postHold.fingerprint,bn006Key),jar),
    ]);
    assert.deepEqual(parallel.map(x=>x.response.status).sort(),[200,201],
      "BN-006 same-key race must return one original pending request");
    const bn006Cash=parallel[0].body.id;
    assert.equal(bn006Cash,parallel[1].body.id);
    const proof=(await pool.query(`SELECT r.application_id,r.amount_minor::text AS amount,
      r.allocation_count,s.status,s.debtor_id,s.creditor_id
      FROM group_settlement_bilateral_residual_repayments r
      JOIN settlements s ON s.id=r.settlement_id
      WHERE r.settlement_id=$1`,[bn006Cash])).rows[0];
    assert.equal(proof.application_id,applied.id);
    assert.equal(proof.amount,postHold.amountMinor);
    assert.equal(proof.allocation_count,postHold.allocationCount);
    assert.equal(proof.status,"pending");
    assert.equal(proof.debtor_id,postHold.debtorId);
    assert.equal(proof.creditor_id,postHold.creditorId);
    assert.equal((await expenseRequest("POST",bn006Url,
      bn006Body(postHold.fingerprint,bn006Key),jar)).response.status,200);
    assert.equal((await expenseRequest("POST",bn006Url,
      bn006Body(postHold.fingerprint,bn006Key,"changed note"),jar))
      .response.status,409,"idempotency key is bound to exact document");
    assert.equal((await expenseRequest("POST",bn006Url,
      bn006Body(postHold.fingerprint),cashCounterparty))
      .response.status,409,"double spend while cash is pending");
    const pendingPreview=(await expenseRequest("GET",bn006Url,undefined,otherJar)).body;
    assert.equal(pendingPreview.preview.status,"blocked");
    assert.equal(pendingPreview.history[0].status,"pending");
    assert.equal((await expenseRequest("PATCH",`${bnCash}/${bn006Cash}`,
      {action:"confirm"},jar))
      .response.status,403,"cash initiator cannot confirm own transfer");
    assert.equal((await pool.query(`SELECT status FROM settlements
      WHERE id=$1`,[bn006Cash])).rows[0].status,"pending");
    await assert.rejects(pool.query(`UPDATE
      group_settlement_bilateral_residual_repayments
      SET amount_minor=1 WHERE settlement_id=$1`,[bn006Cash]),/append-only/);
    await assert.rejects(pool.query(`DELETE FROM
      group_settlement_bilateral_residual_repayments
      WHERE settlement_id=$1`,[bn006Cash]),/append-only/);

    // Rejection releases original availability. Retry must create a new
    // immutable cash receipt (same original NONCASH proof) with a new key.
    assert.equal((await expenseRequest("PATCH",`${bnCash}/${bn006Cash}`,
      {action:"reject"},otherJar)).response.status,200);
    const rejectedPreview=(await expenseRequest("GET",bn006Url,undefined,jar)).body;
    assert.equal(rejectedPreview.preview.status,"ready");
    assert.equal(rejectedPreview.preview.amountMinor,postHold.amountMinor);
    assert.equal(rejectedPreview.history[0].status,"rejected");
    const bn006Final=await expenseRequest("POST",bn006Url,
      bn006Body(rejectedPreview.preview.fingerprint),cashInitiator);
    assert.equal(bn006Final.response.status,201,JSON.stringify(bn006Final.body));
    assert.equal(bn006Final.body.amountMinor,postHold.amountMinor);
    assert.equal((await expenseRequest("PATCH",
      `${bnCash}/${bn006Final.body.id}`,{action:"confirm"},cashCounterparty))
      .response.status,200);
    const settled006=(await expenseRequest("GET",bn006Url,undefined,otherJar)).body;
    assert.equal(settled006.preview.status,"settled");
    assert.equal(settled006.preview.amountMinor,"0");
    assert.equal(settled006.history.length,2);
    assert.equal(settled006.history[0].status,"confirmed");
    assert.equal((await expenseRequest("POST",bn006Url,
      bn006Body(settled006.preview.fingerprint),jar))
      .response.status,409,"zero residual MUST NOT generate a cash transfer");
    assert.equal((await pool.query(`SELECT count(*)::int AS n
      FROM group_settlement_bilateral_application_allocations
      WHERE application_id=$1`,[applied.id])).rows[0].n,originalBN004Count,
      "real money never mutates original noncash application");
    const allZero=(await pool.query(`SELECT COALESCE(sum(b.outstanding_minor),0)::text AS due
      FROM obligations o JOIN bn005_obligation_balances b ON b.obligation_id=o.id
      WHERE o.group_id=$1 AND o.voided_at IS NULL`,[bnGroup])).rows[0].due;
    assert.equal(allZero,"0","entire pair now settled only after other-person confirmation");

    // SC-006: retroactive entry after a sealed snapshot is NOT silently
    // imported or cloned. An explicitly authorized manager attributes the
    // ORIGINAL invoice to the earliest subsequent REVIEW cycle.
    const sc006Group=randomUUID(),sc006Revision=randomUUID();
    const sc006GroupName="SC006 late adjustment";
    await pool.query("INSERT INTO groups(id,owner_id,name) VALUES($1,$2,$3)",
      [sc006Group,registered.user.id,sc006GroupName]);
    for(const [u,role] of [[registered.user.id,"owner"],
      [otherUser.id,"member"],[thirdUser.id,"admin"]])
      await pool.query("INSERT INTO group_members(group_id,user_id,role) VALUES($1,$2,$3)",
        [sc006Group,u,role]);
    const sc006Settings=`${origin}/api/groups/${sc006Group}/settlement-cycle/settings`;
    const sc006Api=`${origin}/api/groups/${sc006Group}/settlement-cycle/cycles`;
    const sc006Expenses=`${origin}/api/groups/${sc006Group}/expenses`;
    assert.equal((await expenseRequest("PATCH",sc006Settings,
      config(0,true,false),jar)).response.status,200);
    await pool.query(`UPDATE group_settlement_config_events
      SET recorded_at=$2::timestamptz
      WHERE group_id=$1 AND event_type='settings_changed'`,
      [sc006Group,sc003Date(-12)+"T00:00:00Z"]);
    await pool.query(`INSERT INTO group_settlement_schedule_heads
      (group_id,updated_by) VALUES($1,$2)`,[sc006Group,registered.user.id]);
    await pool.query(`INSERT INTO group_settlement_schedule_revisions
      (id,group_id,version,frequency,time_zone,anchor_date,effective_at,created_by)
      VALUES($1,$2,1,'manual','UTC',$3,$4,$5)`,
      [sc006Revision,sc006Group,sc003Date(-11),
        sc003Date(-11)+"T00:00:00Z",registered.user.id]);
    const sc006OriginMade=await expenseRequest("POST",sc006Api,{
      expectedScheduleVersion:1,requestKey:randomUUID(),
      startDate:sc003Date(-10),endDate:sc003Date(-7),
    },jar);
    assert.equal(sc006OriginMade.response.status,201,
      JSON.stringify(sc006OriginMade.body));
    const sc006Origin=sc006OriginMade.body.cycle.id;
    const sc006Original=await expenseRequest("POST",sc006Expenses,{
      title:"Original on-time purchase",occurredOn:sc003Date(-9),
      payerId:registered.user.id,items:[{name:"Food",quantity:1,
        unitPriceMinor:"10000",participants:[otherUser.id]}],
    },jar);
    assert.equal(sc006Original.response.status,201);
    assert.equal((await expenseRequest("POST",
      `${sc006Api}/${sc006Origin}/review`,{expectedVersion:1},jar))
      .response.status,200);
    const originSnapshotUrl=`${sc006Api}/${sc006Origin}/snapshot`;
    const originPreview=(await expenseRequest("GET",
      originSnapshotUrl,undefined,jar)).body.snapshot;
    assert.equal(originPreview.expenseCount,1);
    assert.equal((await expenseRequest("POST",originSnapshotUrl,{
      expectedVersion:2,requestKey:randomUUID(),
      expectedFingerprint:originPreview.fingerprint,
    },jar)).response.status,200);

    const late=await expenseRequest("POST",sc006Expenses,{
      title:"Late original grocery invoice",occurredOn:sc003Date(-9),
      payerId:otherUser.id,items:[{name:"Groceries",quantity:1,
        unitPriceMinor:"7000",participants:[registered.user.id]}],
    },otherJar);
    assert.equal(late.response.status,201);
    const lateId=late.body.id;
    assert.equal((await pool.query(`SELECT count(*)::int AS n
      FROM group_settlement_cycle_snapshot_expenses
      WHERE cycle_id=$1 AND expense_id=$2`,
      [sc006Origin,lateId])).rows[0].n,0,
      "late historical invoice never mutates the sealed origin");
    const lateApi=`${sc006Api}/${sc006Origin}/late-adjustments`;
    const lateBefore=await expenseRequest("GET",lateApi,undefined,jar);
    assert.equal(lateBefore.response.status,200,JSON.stringify(lateBefore.body));
    assert.equal(lateBefore.body.total,1);
    assert.equal(lateBefore.body.lateInvoices[0].id,lateId);
    assert.equal(lateBefore.body.eligibleTarget,null);
    assert.equal((await expenseRequest("GET",lateApi,undefined,new Map()))
      .response.status,401);

    const targetMade=await expenseRequest("POST",sc006Api,{
      expectedScheduleVersion:1,requestKey:randomUUID(),
      startDate:sc003Date(-7),endDate:sc003Date(-4),
    },jar);
    assert.equal(targetMade.response.status,201,JSON.stringify(targetMade.body));
    const sc006Target=targetMade.body.cycle.id;
    const onTimeTarget=await expenseRequest("POST",sc006Expenses,{
      title:"Current cycle purchase",occurredOn:sc003Date(-6),
      payerId:registered.user.id,items:[{name:"Dinner",quantity:1,
        unitPriceMinor:"3000",participants:[otherUser.id]}],
    },jar);
    assert.equal(onTimeTarget.response.status,201);
    assert.equal((await expenseRequest("POST",
      `${sc006Api}/${sc006Target}/review`,{expectedVersion:1},jar))
      .response.status,200);
    const targetSnapshotUrl=`${sc006Api}/${sc006Target}/snapshot`;
    const targetBefore=(await expenseRequest("GET",
      targetSnapshotUrl,undefined,jar)).body.snapshot;
    assert.equal(targetBefore.expenseCount,1);
    const assignment=(key=randomUUID(),target=sc006Target,version=1)=>({
      expenseId:lateId,targetCycleId:target,
      expectedExpenseVersion:version,requestKey:key,
      note:"Ghi nhận hóa đơn nhập muộn ở kỳ kế tiếp",
    });
    assert.equal((await expenseRequest("POST",lateApi,
      assignment(),thirdJar)).response.status,403,
      "admin without explicit cycle manager grant cannot attribute");
    assert.equal((await expenseRequest("POST",lateApi,
      assignment(),otherJar)).response.status,403,
      "only owner/delegated manager, not invoice creator, may attribute");
    assert.equal((await expenseRequest("POST",lateApi,{
      ...assignment(),amountMinor:"1"},jar)).response.status,400,
      "client must not supply a financial adjustment amount");
    const key006=randomUUID();
    const doubleAssign=await Promise.all([
      expenseRequest("POST",lateApi,assignment(key006),jar),
      expenseRequest("POST",lateApi,assignment(key006),jar),
    ]);
    assert.deepEqual(doubleAssign.map(x=>x.response.status).sort(),[200,201]);
    assert.equal(doubleAssign[0].body.adjustment.id,
      doubleAssign[1].body.adjustment.id);
    assert.equal((await expenseRequest("POST",lateApi,
      assignment(key006,sc006Target,2),jar)).response.status,409);
    assert.equal((await expenseRequest("POST",lateApi,
      assignment(),jar)).response.status,409,
      "cannot allocate one original invoice twice");
    const changedPreview=(await expenseRequest("GET",
      targetSnapshotUrl,undefined,jar)).body.snapshot;
    assert.equal(changedPreview.expenseCount,2,
      "target snapshot includes both current and attributed ORIGINAL invoice");
    assert.equal(changedPreview.obligationCount,2);
    assert.notEqual(changedPreview.fingerprint,targetBefore.fingerprint);
    assert.equal((await expenseRequest("POST",targetSnapshotUrl,{
      expectedVersion:2,requestKey:randomUUID(),
      expectedFingerprint:targetBefore.fingerprint,
    },jar)).response.status,409,"stale snapshot fingerprint fails closed");
    const frozenLateEdit=await expenseRequest("PATCH",
      `${sc006Expenses}/${lateId}`,{
        expectedVersion:1,expense:{
          title:"Forged historical change",
          occurredOn:sc003Date(-9),payerId:otherUser.id,
          items:[{name:"Changed",quantity:1,unitPriceMinor:"8000",
            participants:[registered.user.id]}],
        },
      },otherJar);
    assert.equal(frozenLateEdit.response.status,409,
      "attributed invoice must be frozen even BEFORE target lock");
    await assert.rejects(pool.query(`
      UPDATE expenses SET occurred_on=$2::date WHERE id=$1`,
      [lateId,sc003Date(-8)]),/Frozen cycle expense/);
    await assert.rejects(pool.query(`
      DELETE FROM group_settlement_cycle_adjustments WHERE expense_id=$1`,
      [lateId]),/immutable/);
    assert.equal((await expenseRequest("POST",targetSnapshotUrl,{
      expectedVersion:2,requestKey:randomUUID(),
      expectedFingerprint:changedPreview.fingerprint,
    },jar)).response.status,200,
      "target lock must preserve historical occurred_on under explicit attribution");
    const sourceRows=await pool.query(`SELECT
      (SELECT count(*)::int FROM group_settlement_cycle_snapshot_expenses
       WHERE cycle_id=$1) AS origin_count,
      (SELECT count(*)::int FROM group_settlement_cycle_snapshot_expenses
       WHERE cycle_id=$2) AS target_count,
      (SELECT count(*)::int FROM group_settlement_cycle_snapshot_obligations
       WHERE expense_id=$3) AS original_obligation_count,
      (SELECT count(*)::int FROM expenses WHERE id=$3) AS original_invoice_count`,
      [sc006Origin,sc006Target,lateId]);
    assert.deepEqual(sourceRows.rows[0],{
      origin_count:1,target_count:2,
      original_obligation_count:1,original_invoice_count:1,
    },"no duplicate original invoice, obligation or frozen snapshot");
    assert.equal((await expenseRequest("GET",lateApi,undefined,jar))
      .body.lateInvoices[0].assignedTargetId,sc006Target);
    // SC-008: audit-proven historical original invoice remains visible
    // in new-cycle rendered source lines with its REAL original date.
    const sc008LatePage=await sc008Page(
      `${origin}/groups/${sc006Group}/cycles/${sc006Target}`,jar);
    assert.equal(sc008LatePage.response.status,200);
    assert.match(sc008LatePage.html,/Late original grocery invoice/);
    assert.match(sc008LatePage.html,/Hóa đơn nhập muộn/);
    assert.match(sc008LatePage.html,/Có chứng từ gán kỳ|có chứng từ gán kỳ/);
    assert.match(sc008LatePage.html,/Chưa phát hành giao dịch quyết toán/);

    // SC-007 release regression: a late invoice's ORIGINAL occurred_on
    // precedes the target cycle, but a proven SC-006 attribution in its
    // sealed snapshot MUST remain eligible for two-person noncash preview.
    // Merely falsifying a date without audited source does not work.
    assert.equal((await expenseRequest("PATCH",sc006Settings,
      config(1,true,true),jar)).response.status,200);
    const adjustedNettingUrl=`${sc006Api}/${sc006Target}/bilateral-proposals?partyAId=${encodeURIComponent(registered.user.id)}&partyBId=${encodeURIComponent(otherUser.id)}`;
    const adjustedPreview=await expenseRequest("GET",
      adjustedNettingUrl,undefined,otherJar);
    assert.equal(adjustedPreview.response.status,200,
      "audited SC-006 late source must NOT block BN-002 pair netting: "+
        JSON.stringify(adjustedPreview.body));
    assert.equal(adjustedPreview.body.eligibleSourceCount,2);
    assert.equal(adjustedPreview.body.calculation.offsetMinor,"3000");
    assert.equal((await pool.query(`SELECT count(*)::int AS n
      FROM group_settlement_bilateral_applications
      WHERE group_id=$1`,[sc006Group])).rows[0].n,0,
      "preview must not create any NONCASH application automatically");
    // SC-006: zero-debt creator responsibility is independent of ledger
    // balances. One cannot abandon an invoice frozen in a cycle and make
    // it impossible for the only creator to confirm completion.
    // A legitimate logged-in outsider cannot see private group/cycle money.
    const forbiddenCycle=await sc008Page(
      `${origin}/groups/${sc006Group}/cycles/${sc006Target}`,new Map());
    assert.ok([200,307].includes(forbiddenCycle.response.status));
    // SC-009: dispute, privacy, notification, immutable audit, full source
    // report and CSV export, all on a REAL signed PG17 HTTP fixture.
    const sc009Base=`${sc006Api}/${sc006Target}`;
    const sc009Disputes=`${sc009Base}/disputes`;
    const sc009Report=`${sc009Base}/reconciliation`;
    const sc009Audit=`${sc009Base}/audit`;
    const sc009Original=(await pool.query(`
      SELECT so.obligation_id AS id,so.debtor_id AS debtor,so.creditor_id AS creditor
      FROM group_settlement_cycle_snapshot_obligations so
      WHERE so.group_id=$1 AND so.cycle_id=$2 AND
        $3 IN(so.debtor_id,so.creditor_id)
      ORDER BY so.obligation_id LIMIT 1`,
      [sc006Group,sc006Target,registered.user.id])).rows[0];
    assert.ok(sc009Original?.id);
    const sc009Before=await expenseRequest("GET",sc009Report,undefined,jar);
    assert.equal(sc009Before.response.status,200,JSON.stringify(sc009Before.body));
    assert.equal(sc009Before.body.sourceCount,2);
    assert.equal(sc009Before.body.confirmedSetoffMinor,"0");
    assert.equal(sc009Before.body.pendingCashMinor,"0");
    const sc009Opening={
      obligationId:sc009Original.id,
      reason:"Vui lòng kiểm tra số tiền chia của hóa đơn gốc này.",
      requestKey:randomUUID(),
    };
    assert.equal((await expenseRequest("GET",sc009Disputes,undefined,new Map()))
      .response.status,401,"anonymous cannot read dispute notes");
    assert.equal((await expenseRequest("POST",sc009Disputes,
      sc009Opening,thirdJar)).response.status,403,
      "group admin NOT one of the actual two counterparties");
    assert.equal((await expenseRequest("POST",sc009Disputes,{
      ...sc009Opening,actorId:thirdUser.id,
    },jar)).response.status,400,"client cannot spoof dispute actor");
    // A genuine pre-existing PENDING original cash request is retained
    // as history when the counterparty opens a new dispute. No auto-cancel.
    const sc009PendingId=randomUUID(),manual=await pool.connect();
    try{
      await manual.query("BEGIN");
      await manual.query(`INSERT INTO settlements
        (id,group_id,debtor_id,creditor_id,initiated_by,status,amount_minor,
         request_key,request_fingerprint) VALUES($1,$2,$3,$4,$5,'pending',1,$6,$7)`,
        [sc009PendingId,sc006Group,sc009Original.debtor,
          sc009Original.creditor,registered.user.id,randomUUID(),"a".repeat(64)]);
      await manual.query(`INSERT INTO settlement_allocations
        (settlement_id,obligation_id,group_id,debtor_id,creditor_id,amount_minor)
        VALUES($1,$2,$3,$4,$5,1)`,
        [sc009PendingId,sc009Original.id,sc006Group,sc009Original.debtor,
          sc009Original.creditor]);
      await manual.query("COMMIT");
    }catch(e){await manual.query("ROLLBACK");throw e;}
    finally{manual.release();}
    const sc009Opened=await expenseRequest("POST",sc009Disputes,
      sc009Opening,jar);
    assert.equal(sc009Opened.response.status,201,JSON.stringify(sc009Opened.body));
    const sc009Id=sc009Opened.body.dispute.id;
    assert.equal(sc009Opened.body.dispute.status,"open");
    assert.equal((await expenseRequest("POST",sc009Disputes,sc009Opening,jar))
      .response.status,200,"exact key retried idempotently");
    assert.equal((await expenseRequest("POST",sc009Disputes,{
      ...sc009Opening,reason:"Nội dung khác cho cùng requestKey",
    },jar)).response.status,409);
    assert.equal((await expenseRequest("POST",sc009Disputes,{
      ...sc009Opening,requestKey:randomUUID(),
    },otherJar)).response.status,409,"only ONE open thread per source");
    const sc009Other=await expenseRequest("GET",sc009Disputes,undefined,otherJar);
    assert.equal(sc009Other.response.status,200);
    assert.equal(sc009Other.body.disputes[0].id,sc009Id);
    const sc009Admin=await expenseRequest("GET",sc009Disputes,undefined,thirdJar);
    assert.equal(sc009Admin.response.status,200);
    assert.equal(sc009Admin.body.disputes.length,0,
      "group admin cannot read unrelated pair's private dispute contents");

    const sc009Notice=await expenseRequest("GET",
      `${origin}/api/notifications?limit=50`,undefined,otherJar);
    assert.equal(sc009Notice.response.status,200);
    assert.ok(sc009Notice.body.notifications.some(x=>x.kind==="cycle_dispute_opened"&&
      x.href===`/groups/${sc006Group}/cycles/${sc006Target}`));
    assert.equal((await pool.query(`SELECT count(*)::int AS n
      FROM notifications WHERE recipient_id=$1 AND kind='cycle_dispute_opened'
        AND cycle_id=$2`,[otherUser.id,sc006Target])).rows[0].n,1,
      "event-key notice cannot duplicate on HTTP retry");

    // Disputed ORIGINAL source must fail closed for SC-005 pending CASH,
    // and must prevent confirming even a PRE-EXISTING cash reservation.
    const sc009Batch=`${sc009Base}/repayments`;
    const sc009BatchPreview=await expenseRequest("GET",sc009Batch,undefined,jar);
    assert.equal(sc009BatchPreview.response.status,200);
    const sc009Direction=sc009BatchPreview.body.pairs.find(p=>
      p.debtorId===sc009Original.debtor&&p.creditorId===sc009Original.creditor);
    assert.ok(sc009Direction&&BigInt(sc009Direction.availableMinor)>0n);
    const sc009CashBefore=(await pool.query(`SELECT count(*)::int AS n
      FROM group_settlement_cycle_repayments WHERE group_id=$1 AND cycle_id=$2`,
      [sc006Group,sc006Target])).rows[0].n;
    const sc009DeniedCash=await expenseRequest("POST",sc009Batch,{
      expectedCycleVersion:3,requestKey:randomUUID(),
      debtorId:sc009Original.debtor,creditorId:sc009Original.creditor,
      expectedFingerprint:sc009Direction.fingerprint,
    },jar);
    assert.equal(sc009DeniedCash.response.status,409,
      "new cycle cash that touches active dispute must be denied, never 500");
    assert.equal((await pool.query(`SELECT count(*)::int AS n
      FROM group_settlement_cycle_repayments WHERE group_id=$1 AND cycle_id=$2`,
      [sc006Group,sc006Target])).rows[0].n,sc009CashBefore);

    await assert.rejects(pool.query(`
      UPDATE settlements SET status='confirmed',resolved_at=now(),resolved_by=$2
      WHERE id=$1`,[sc009PendingId,otherUser.id]),
      /SC-009 disputed original obligation cannot be cash-confirmed/);
    assert.equal((await pool.query(`SELECT status FROM settlements
      WHERE id=$1`,[sc009PendingId])).rows[0].status,"pending");
    await pool.query(`UPDATE settlements
      SET status='cancelled',resolved_at=now(),resolved_by=$2
      WHERE id=$1`,[sc009PendingId,registered.user.id]);
    const sc009Blocked=await expenseRequest("GET",sc009Report,undefined,jar);
    assert.equal(sc009Blocked.response.status,200);
    assert.equal(sc009Blocked.body.unresolvedDisputes,1);
    assert.equal(sc009Blocked.body.readyForManualReview,false);
    const sc009ActorAudit=await expenseRequest("GET",sc009Audit,undefined,jar);
    assert.equal(sc009ActorAudit.response.status,200);
    assert.ok(sc009ActorAudit.body.items.some(x=>
      x.kind==="dispute"&&x.eventType==="opened"&&x.subjectId===sc009Original.id));
    const sc009OutsiderAudit=await expenseRequest("GET",sc009Audit,undefined,thirdJar);
    assert.equal(sc009OutsiderAudit.response.status,200);
    assert.ok(!sc009OutsiderAudit.body.items.some(x=>x.kind==="dispute"),
      "admin not in pair cannot see private dispute events in audit");

    const csvDownload=async(kind,cookies)=>{
      const response=await fetch(`${sc009Base}/export?kind=${kind}`,{
        headers:cookies.size?{cookie:cookieHeader(cookies)}:{},
        signal:AbortSignal.timeout(20000),
      });
      // Fetch Response.text() strips a UTF-8 BOM by specification.
      // Inspect raw bytes instead to verify the Excel-friendly CSV signature.
      const bytes=Buffer.from(await response.arrayBuffer());
      return {response,text:bytes.toString("utf8"),bytes};
    };
    assert.equal((await csvDownload("ledger",new Map())).response.status,401);
    const sc009Ledger=await csvDownload("ledger",jar);
    assert.equal(sc009Ledger.response.status,200,sc009Ledger.text.slice(0,100));
    assert.match(sc009Ledger.response.headers.get("content-type"),/text\/csv/);
    assert.ok(sc009Ledger.text.startsWith("\uFEFF"));
    assert.equal(sc009Ledger.text.trim().split("\r\n").length,3,
      "CSV MUST contain ALL 2 original obligations, not one UI page");
    assert.match(sc009Ledger.text,/Hóa đơn gốc/);
    assert.match(sc009Ledger.text,/Late original grocery invoice/);
    assert.match(sc009Ledger.text,/Đã bù trừ phi tiền mặt|Bù trừ phi tiền mặt/);
    const sc009Export=await csvDownload("audit",jar);
    assert.equal(sc009Export.response.status,200);
    assert.match(sc009Export.text,/dispute/);
    const sc009AdminExport=await csvDownload("audit",thirdJar);
    assert.equal(sc009AdminExport.response.status,200);
    assert.doesNotMatch(sc009AdminExport.text,/"dispute"/,
      "audit export cannot leak another pair's dispute notes");
    assert.equal((await csvDownload("other",jar)).response.status,400);

    const sc009EventUrl=`${sc009Disputes}/${sc009Id}/events`;
    const respondBody={eventType:"respond",body:"Tôi đã rà soát hóa đơn, cách tính hợp lệ.",
      requestKey:randomUUID()};
    assert.equal((await expenseRequest("POST",sc009EventUrl,
      respondBody,jar)).response.status,409,
      "reporter cannot forge counterparty's reply");
    assert.equal((await expenseRequest("POST",sc009EventUrl,
      respondBody,thirdJar)).response.status,403);
    assert.equal((await expenseRequest("POST",sc009EventUrl,
      respondBody,otherJar)).response.status,201);
    assert.equal((await expenseRequest("POST",sc009EventUrl,
      respondBody,otherJar)).response.status,200);
    const sc009Awaiting=await expenseRequest("GET",sc009Disputes,undefined,jar);
    assert.equal(sc009Awaiting.body.disputes[0].status,"awaiting_reporter");
    assert.equal(sc009Awaiting.body.disputes[0].events.length,1);
    assert.equal((await expenseRequest("POST",sc009EventUrl,{
      eventType:"resolve",body:"Bên mở đã kiểm tra và đồng ý kết thúc.",
      requestKey:randomUUID(),
    },otherJar)).response.status,409,
      "counterparty cannot resolve unilaterally");
    const sc009Closed=await expenseRequest("POST",sc009EventUrl,{
      eventType:"resolve",body:"Tôi xác nhận tranh chấp đã được giải quyết.",
      requestKey:randomUUID(),
    },jar);
    assert.equal(sc009Closed.response.status,201,JSON.stringify(sc009Closed.body));
    assert.equal(sc009Closed.body.dispute.status,"resolved");
    assert.equal((await expenseRequest("POST",sc009EventUrl,{
      eventType:"respond",body:"Thử thêm phản hồi sau khi đóng.",
      requestKey:randomUUID(),
    },otherJar)).response.status,409);
    await assert.rejects(pool.query(`
      UPDATE group_settlement_cycle_disputes SET reason='tampered'
      WHERE id=$1`,[sc009Id]),/immutable/);
    await assert.rejects(pool.query(`
      DELETE FROM group_settlement_cycle_dispute_events
      WHERE dispute_id=$1`,[sc009Id]),/immutable/);
    const sc009After=await expenseRequest("GET",sc009Report,undefined,jar);
    assert.equal(sc009After.response.status,200);
    assert.equal(sc009After.body.unresolvedDisputes,0);
    for(const field of ["originalMinor","confirmedCashMinor",
      "confirmedSetoffMinor","pendingCashMinor","outstandingMinor","availableMinor"])
      assert.equal(sc009After.body[field],sc009Before.body[field],
        "dispute discussion cannot mutate any real financial amounts");

    // Notification idempotency remains valid for cron/system actors:
    // duplicate calls from separate attempts create exactly ONE reminder.
    const reminderKey=`remind:ci:dispute:${sc009Id}`;
    await Promise.all([pool.query(`
      SELECT sc009_emit_notice($1,$2,$3,NULL,$4,'cycle_reminder',
        'Nhắc nhở đối soát','Chỉ ghi thông báo, không chuyển tiền.',$5)`,
        [sc006Group,sc006Target,registered.user.id,reminderKey,
          `/groups/${sc006Group}/cycles/${sc006Target}`]),
      pool.query(`
      SELECT sc009_emit_notice($1,$2,$3,NULL,$4,'cycle_reminder',
        'Nhắc nhở đối soát','Chỉ ghi thông báo, không chuyển tiền.',$5)`,
        [sc006Group,sc006Target,registered.user.id,reminderKey,
          `/groups/${sc006Group}/cycles/${sc006Target}`])]);
    assert.equal((await pool.query(`SELECT count(*)::int AS n
      FROM notifications WHERE recipient_id=$1 AND event_key=$2`,
      [registered.user.id,reminderKey])).rows[0].n,1);
    const sc006ExitGroup=randomUUID(),sc006ExitRev=randomUUID();
    await pool.query(`INSERT INTO groups(id,owner_id,name)
      VALUES($1,$2,'SC006 lifecycle group')`,
      [sc006ExitGroup,registered.user.id]);
    for(const [userId,role] of [[registered.user.id,"owner"],[otherUser.id,"member"]])
      await pool.query(`INSERT INTO group_members(group_id,user_id,role)
        VALUES($1,$2,$3)`,[sc006ExitGroup,userId,role]);
    const exitSettings=`${origin}/api/groups/${sc006ExitGroup}/settlement-cycle/settings`;
    const exitCycles=`${origin}/api/groups/${sc006ExitGroup}/settlement-cycle/cycles`;
    const exitInvoices=`${origin}/api/groups/${sc006ExitGroup}/expenses`;
    const exitMembership=`${origin}/api/groups/${sc006ExitGroup}/membership/leave`;
    assert.equal((await expenseRequest("PATCH",exitSettings,
      config(0,true,false),jar)).response.status,200);
    await pool.query(`UPDATE group_settlement_config_events
      SET recorded_at=$2::timestamptz
      WHERE group_id=$1 AND event_type='settings_changed'`,
      [sc006ExitGroup,sc003Date(-8)+"T00:00:00Z"]);
    await pool.query(`INSERT INTO group_settlement_schedule_heads
      (group_id,updated_by) VALUES($1,$2)`,
      [sc006ExitGroup,registered.user.id]);
    await pool.query(`INSERT INTO group_settlement_schedule_revisions
      (id,group_id,version,frequency,time_zone,anchor_date,effective_at,created_by)
      VALUES($1,$2,1,'manual','UTC',$3,$4,$5)`,
      [sc006ExitRev,sc006ExitGroup,sc003Date(-7),
        sc003Date(-7)+"T00:00:00Z",registered.user.id]);
    const exitCycle=await expenseRequest("POST",exitCycles,{
      expectedScheduleVersion:1,requestKey:randomUUID(),
      startDate:sc003Date(-6),endDate:sc003Date(-3),
    },jar);
    assert.equal(exitCycle.response.status,201);
    const exitCycleId=exitCycle.body.cycle.id;
    const selfInvoice=await expenseRequest("POST",exitInvoices,{
      title:"B paid own meal (no pair debt)",occurredOn:sc003Date(-5),
      payerId:otherUser.id,items:[{name:"Self meal",quantity:1,
        unitPriceMinor:"12000",participants:[otherUser.id]}],
    },otherJar);
    assert.equal(selfInvoice.response.status,201,JSON.stringify(selfInvoice.body));
    assert.equal((await expenseRequest("POST",
      `${exitCycles}/${exitCycleId}/review`,{expectedVersion:1},jar))
      .response.status,200);
    const exitSnapUrl=`${exitCycles}/${exitCycleId}/snapshot`;
    const exitPreview=(await expenseRequest("GET",exitSnapUrl,undefined,jar)).body.snapshot;
    assert.equal(exitPreview.obligationCount,0);
    assert.equal(exitPreview.expenseCount,1);
    assert.equal((await expenseRequest("POST",exitSnapUrl,{
      expectedVersion:2,requestKey:randomUUID(),
      expectedFingerprint:exitPreview.fingerprint,
    },jar)).response.status,200);
    const ownExit=(await expenseRequest("GET",exitMembership,undefined,otherJar)).body.eligibility;
    assert.equal(ownExit.toPayMinor,"0");
    assert.equal(ownExit.toReceiveMinor,"0");
    assert.equal(ownExit.uncompletedInvoiceCount,1);
    assert.equal(ownExit.canLeave,false);
    assert.equal(ownExit.reason,"creator_confirmation");
    assert.equal((await expenseRequest("POST",exitMembership,{},otherJar))
      .response.status,409,"cannot leave when only creator can finalize frozen invoice");
    assert.equal((await expenseRequest("POST",
      `${exitInvoices}/${selfInvoice.body.id}/complete`,
      {expectedVersion:1},jar)).response.status,403,
      "group owner must not finalize B's invoice");
    assert.equal((await expenseRequest("POST",
      `${exitInvoices}/${selfInvoice.body.id}/complete`,
      {expectedVersion:1},otherJar)).response.status,200);

    // Recurring template with departed creator must be paused in the SAME
    // membership transaction, never generate invoices for a former member.
    const recurringExit=await expenseRequest("POST",
      `${origin}/api/groups/${sc006ExitGroup}/recurring`,{
        title:"B monthly own fixed expense",notes:"",
        dayOfMonth:Number(sc003Date(1).slice(8)),
        startsOn:sc003Date(1),payerId:otherUser.id,
        items:[{name:"Monthly",quantity:1,unitPriceMinor:"5000",
          participants:[otherUser.id]}],
      },otherJar);
    assert.equal(recurringExit.response.status,201,JSON.stringify(recurringExit.body));
    const recurringId=recurringExit.body.id;
    assert.equal((await pool.query(`SELECT status FROM recurring_expense_rules
      WHERE id=$1`,[recurringId])).rows[0].status,"active");
    assert.equal((await expenseRequest("GET",exitMembership,undefined,otherJar))
      .body.eligibility.canLeave,true);
    assert.equal((await expenseRequest("POST",exitMembership,{},otherJar))
      .response.status,200);
    assert.equal((await pool.query(`SELECT status FROM recurring_expense_rules
      WHERE id=$1`,[recurringId])).rows[0].status,"paused");
    assert.equal((await pool.query(`SELECT status FROM group_members
      WHERE group_id=$1 AND user_id=$2`,
      [sc006ExitGroup,otherUser.id])).rows[0].status,"left");
    const archiveAfter=await expenseRequest("POST",
      `${origin}/api/groups/${sc006ExitGroup}/archive`,
      {confirmation:"SC006 lifecycle group"},jar);
    assert.equal(archiveAfter.response.status,200,JSON.stringify(archiveAfter.body));
    assert.ok((await pool.query("SELECT archived_at FROM groups WHERE id=$1",
      [sc006ExitGroup])).rows[0].archived_at,
      "archival allowed once immutable cycle audit and creator responsibilities are resolved");
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
