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
