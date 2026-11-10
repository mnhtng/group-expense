/**
 * RR-002: REAL Chromium/WebKit browser E2E, including simulated phone viewports.
 * All synthetic fixture financial writes are restricted to throwaway CI PG17.
 * NO production/staging/Neon connections or financial release overrides.
 *
 * Physical iOS/Android devices and installed-PWA behavior require an
 * independent manual/device-farm signoff; emulation is not that evidence.
 */
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {spawn} from "node:child_process";
import {mkdir} from "node:fs/promises";
import {pathToFileURL} from "node:url";
import {test} from "node:test";
import {fixtureDatabaseUrl} from "../db/rr004-local-runtime.mjs";
import {seedHistoricalCycleSettings} from "./helpers/settlement-history.mjs";

const ONLY_DB="postgresql://test:test@localhost:5432/group_expense";
const ORIGIN="http://localhost:3112";
function guard(env=process.env){
  if(env.CI!=="true"||env.RR002_TEST_ONLY!=="isolated-pg17"||
     env.DATABASE_URL!==ONLY_DB||env.BETTER_AUTH_URL!==ORIGIN||
     !env.RR002_PLAYWRIGHT_ENTRY?.startsWith("/")||
     !env.RR002_PLAYWRIGHT_ENTRY.endsWith("/playwright/index.mjs"))
    throw Error("RR-002 refuses a non-disposable database, missing browser or unexpected origin");
  for(const flag of ["BN004_TEST_ONLY","BN006_TEST_ONLY","SC005_TEST_ONLY",
    "SC009_TEST_ONLY","SC007_TEST_ONLY"]){
    if(env[flag])throw Error("RR-002 does not enable finance test write flags");
  }
}
guard(); // MUST precede any DB connection, Next.js startup or browser load.
const playwright=await import(pathToFileURL(process.env.RR002_PLAYWRIGHT_ENTRY).href);
const pg=(await import("pg")).default;
const pool=new pg.Pool({connectionString:fixtureDatabaseUrl(),max:4});
const port=3112;
const password="RR002-synthetic-password-123!";
const day=n=>{
  const date=new Date();
  date.setUTCHours(12,0,0,0);
  date.setUTCDate(date.getUTCDate()+n);
  return date.toISOString().slice(0,10);
};
const pathFor=(gid,cycle)=>"/groups/"+gid+"/cycles"+(cycle?"/"+cycle:"");
const apiFor=(gid,cycle)=>"/api/groups/"+gid+"/settlement-cycle/cycles"+
  (cycle?"/"+cycle:"");
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

async function waitForServer(proc){
  for(let i=0;i<120;i++){
    assert.equal(proc.exitCode,null,"Next server terminated during RR-002 setup");
    try{
      const r=await fetch(ORIGIN+"/sign-in",{signal:AbortSignal.timeout(1200)});
      if(r.ok)return;
    }catch{}
    await sleep(500);
  }
  throw Error("RR-002 Next production server never started");
}
async function send(user,method,url,data){
  const response=await user.context.request.fetch(ORIGIN+url,{
    method,headers:{origin:ORIGIN,...(data?{"content-type":"application/json"}:{})},
    ...(data?{data}:{}),timeout:20000,
  });
  let body=null;
  try{body=await response.json();}catch{}
  return {response,body};
}
// Observe a real browser POST without hiding Playwright click/actionability
// errors behind a shorter response timeout. The listener is armed BEFORE
// the actual user click and catches even responses that finish during click().
async function observeBrowserPost(page,path,activate,timeout=20000){
  let observed=null;
  let notify=null;
  const recordResponse=response=>{
    if(response.request().method()==="POST"&&
       new URL(response.url()).pathname===path){
      observed=response;
      if(notify)notify(response);
    }
  };
  page.on("response",recordResponse);
  try{
    // This must settle (or fail with Playwright's actionable click call log)
    // BEFORE the HTTP wait starts. Promise.all would hide a pending click.
    await activate();
    if(observed)return observed;
    let timer;
    try{
      return await new Promise((resolve,reject)=>{
        notify=resolve;
        timer=setTimeout(()=>reject(new Error(
          "RR-002 timed out awaiting browser POST response after a completed click: "+
          path)),timeout);
      });
    }finally{clearTimeout(timer);}
  }finally{page.off("response",recordResponse);}
}
async function must(user,method,path,body,expected=200){
  const {response,body:payload}=await send(user,method,path,body);
  assert.equal(response.status(),expected,method+" "+path+" => "+response.status()+
    " expected "+expected+"; "+JSON.stringify(payload)?.slice(0,150));
  return payload;
}
async function userFor(browser,options,tag){
  const context=await browser.newContext({...options,baseURL:ORIGIN,
    acceptDownloads:true,serviceWorkers:"allow"});
  const email="rr002-"+tag+"-"+randomUUID()+"@example.test";
  // Keep real Better Auth rate limiting ON. A disposable runner creates
  // several users from one loopback IP; wait for its advertised cooldown
  // instead of spoofing identity or weakening the product auth policy.
  let response;
  for(let attempt=0;attempt<6;attempt++){
    response=await context.request.post(ORIGIN+"/api/auth/sign-up/email",{
      headers:{origin:ORIGIN},
      data:{name:"RR002 "+tag,email,password},
      timeout:20000,
    });
    if(response.status()!==429)break;
    if(attempt===5)break;
    const cooldown=response.headers()["x-retry-after"] ??
      response.headers()["retry-after"] ?? "10";
    const seconds=Number(cooldown);
    await sleep(Number.isFinite(seconds)&&seconds>=0
      ?Math.min(31000,Math.max(11000,Math.ceil(seconds*1000)+1000))
      :11000);
  }
  assert.equal(response.status(),200,
    "Better Auth synthetic signup must succeed without disabling rate limiting");
  const payload=await response.json();
  assert.ok(payload.user?.id,"Better Auth user ID");
  assert.ok((await context.cookies(ORIGIN)).some(c=>c.name.includes("session_token")),
    "Browser context must hold a real session cookie");
  return {context,page:await context.newPage(),id:payload.user.id,name:"RR002 "+tag};
}
async function seedSyntheticSources(groupId,ownerId,otherId,occurredOn){
  // Intentionally write synthetic original invoice/obligation rows ONLY to
  // this throwaway CI DB, never on Neon. 52 extra sources exercise 50-row UI paging.
  await pool.query(
    "INSERT INTO expenses(id,group_id,payer_id,created_by,title,occurred_on,total_minor) "+
    "SELECT gen_random_uuid(),$1,$2,$2,'RR002 Bulk '||g::text,$3::date,1000 "+
    "FROM generate_series(1,52) AS g",
    [groupId,ownerId,occurredOn]);
  await pool.query(
    "INSERT INTO expense_items(id,expense_id,group_id,position,name,quantity,unit_price_minor,amount_minor) "+
    "SELECT gen_random_uuid(),id,group_id,0,'Synthetic bulk',1,1000,1000 "+
    "FROM expenses WHERE group_id=$1 AND title LIKE 'RR002 Bulk %'",[groupId]);
  await pool.query(
    "INSERT INTO expense_item_shares(item_id,group_id,user_id,amount_minor) "+
    "SELECT i.id,i.group_id,$2,1000 FROM expense_items i "+
    "JOIN expenses e ON e.id=i.expense_id WHERE e.group_id=$1 "+
    "AND e.title LIKE 'RR002 Bulk %'",[groupId,otherId]);
  await pool.query(
    "INSERT INTO obligations(id,group_id,expense_id,expense_version,debtor_id,creditor_id,amount_minor) "+
    "SELECT gen_random_uuid(),group_id,id,1,$2,$3,1000 FROM expenses "+
    "WHERE group_id=$1 AND title LIKE 'RR002 Bulk %'",[groupId,otherId,ownerId]);
  await pool.query(
    "INSERT INTO obligation_sources(id,obligation_id,expense_item_id,item_name,amount_minor) "+
    "SELECT gen_random_uuid(),o.id,i.id,'Synthetic bulk',1000 FROM obligations o "+
    "JOIN expense_items i ON i.expense_id=o.expense_id "+
    "JOIN expenses e ON e.id=o.expense_id WHERE o.group_id=$1 "+
    "AND e.title LIKE 'RR002 Bulk %'",[groupId]);
}
async function originalBalance(groupId){
  const r=await pool.query(
    "SELECT (SELECT count(*)::int FROM obligations WHERE group_id=$1) AS obligations, "+
    "(SELECT coalesce(sum(amount_minor),0)::text FROM obligations WHERE group_id=$1) AS original, "+
    "(SELECT count(*)::int FROM settlements WHERE group_id=$1) AS cash_requests, "+
    "(SELECT count(*)::int FROM group_settlement_bilateral_applications WHERE group_id=$1) AS noncash_docs, "+
    "(SELECT count(*)::int FROM settlement_allocations WHERE group_id=$1) AS cash_allocations",
    [groupId]);
  return r.rows[0];
}
async function capture(page,project,label){
  await mkdir("rr002-artifacts",{recursive:true});
  await page.screenshot({path:"rr002-artifacts/"+project+"-"+label+".png",
    fullPage:true,animations:"disabled",timeout:20000});
}
// Read-only hit-test probe for the focus/overlay hypothesis. It never
// changes navigation, click dispatch, keyboard focus, browser auth or money.
async function installSnapshotPointerProbe(page){
  await page.evaluate(()=>{
    const events=[];
    const types=["pointerdown","mousedown","focusin","focusout",
      "pointerup","mouseup","click"];
    const label=node=>{
      if(!(node instanceof Element))return "other";
      if(node.closest(".app-bottom-nav"))return "bottom-nav";
      if(node.closest("button")?.textContent
        ?.includes("Chốt số liệu"))return "lock-button";
      if(node.closest('input[type="checkbox"]'))return "checkbox";
      if(node.closest("button"))return "other-button";
      if(node.closest("main"))return "main";
      return node.tagName.toLowerCase();
    };
    const metrics=node=>{
      if(!(node instanceof Element))return null;
      const rect=node.getBoundingClientRect();
      const style=getComputedStyle(node);
      return {top:Math.round(rect.top),bottom:Math.round(rect.bottom),
        height:Math.round(rect.height),display:style.display,
        pointerEvents:style.pointerEvents,zIndex:style.zIndex};
    };
    const capture=event=>{
      const nav=document.querySelector(".app-bottom-nav");
      const lock=[...document.querySelectorAll("button")].find(button=>
        button.textContent?.includes("Chốt số liệu"));
      const pointer=event instanceof MouseEvent;
      const x=pointer?Math.round(event.clientX):null;
      const y=pointer?Math.round(event.clientY):null;
      events.push({type:event.type,target:label(event.target),
        focused:label(document.activeElement),
        x,y,hit:pointer?label(document.elementFromPoint(x,y)):null,
        nav:metrics(nav),lock:metrics(lock)});
      if(events.length>24)events.shift();
    };
    for(const type of types)document.addEventListener(type,capture,true);
    globalThis.__rr002PointerProbe={
      events,
      snapshot:()=>({events:[...events],viewport:{
        width:innerWidth,height:innerHeight,scrollY:Math.round(scrollY)}}),
      stop:()=>{for(const type of types)
        document.removeEventListener(type,capture,true);},
    };
  });
}
async function assertTapTarget(locator,name){
  const rect=await locator.boundingBox();
  assert.ok(rect && rect.height>=44-0.5,
    name+" must have >=44 CSS px height; got "+(rect?.height??"missing"));
}
async function noHorizontalOverflow(page,name){
  const dims=await page.evaluate(()=>({
    scroll:document.documentElement.scrollWidth,
    client:document.documentElement.clientWidth,
  }));
  assert.ok(dims.scroll<=dims.client+2,
    name+" horizontal overflow "+JSON.stringify(dims));
}
async function scenario(engine,project,options,actors){
  const browser=await engine.launch({headless:true});
  const users=[];
  const create=async tag=>{
    // Reuse one actual server-issued Better Auth identity per human role
    // across independent browser profiles. Every scenario creates a NEW
    // browser context with its own cookie jar and NEW isolated group.
    // We do not spoof tokens or relax signup rate limits.
    const actor=actors[tag];
    assert.ok(actor,"missing signed fixture actor: "+tag);
    const context=await browser.newContext({...options,baseURL:ORIGIN,
      acceptDownloads:true,serviceWorkers:"allow",storageState:actor.storageState});
    const u={context,page:await context.newPage(),id:actor.id,name:actor.name};
    users.push(u);
    return u;
  };
  try{
    // Anonymous deep link never renders private financial content.
    const anonymous=await browser.newContext({...options,baseURL:ORIGIN});
    const anonymousPage=await anonymous.newPage();
    await anonymousPage.goto(ORIGIN+"/groups?tab=recent");
    await anonymousPage.getByRole("heading",{name:"Đăng nhập"}).waitFor();
    assert.ok(anonymousPage.url().includes("/sign-in"));
    await anonymous.close();

    const owner=await create("owner");
    const other=await create("counterparty");
    const admin=await create("admin");
    const outsider=await create("outsider");

    // Mobile redesign: a real browser creates a group and an expense through
    // separate screens, retains both form steps, then verifies stored money.
    await owner.page.goto(ORIGIN+"/groups");
    await owner.page.getByRole("link",{name:"Tạo nhóm",exact:true}).click();
    await owner.page.waitForURL("**/groups/new");
    const uiGroupName="RR002 mobile "+randomUUID().slice(0,8);
    await owner.page.getByLabel("Tên nhóm",{exact:true}).fill(uiGroupName);
    const groupPost=await observeBrowserPost(owner.page,"/api/groups",
      ()=>owner.page.getByRole("button",{name:"Tạo nhóm",exact:true}).click());
    assert.equal(groupPost.status(),201);
    const uiGroupId=(await groupPost.json()).id;
    await owner.page.waitForURL("**/groups/"+uiGroupId);
    for(const member of [other,admin])await pool.query(
      "INSERT INTO group_members(group_id,user_id,role) VALUES($1,$2,'member')",
      [uiGroupId,member.id]);
    await owner.page.getByRole("link",{name:"Thêm khoản",exact:true}).click();
    await owner.page.getByLabel("Tên khoản chi",{exact:true}).fill("RR002 chia tiền lẻ");
    await owner.page.getByRole("button",{name:"Thêm ghi chú",exact:true}).click();
    await owner.page.getByLabel("Ghi chú",{exact:true}).fill("Giữ nội dung khi đổi bước");
    await owner.page.getByRole("button",{name:"Tiếp",exact:true}).click();
    await owner.page.getByLabel("Tên món 1",{exact:true}).fill("Bữa tối");
    await owner.page.getByLabel("Đơn giá (VND)",{exact:true}).fill("100001");
    await owner.page.getByRole("button",{name:"Thông tin",exact:true}).click();
    assert.equal(await owner.page.getByLabel("Tên khoản chi",{exact:true}).inputValue(),"RR002 chia tiền lẻ");
    assert.equal(await owner.page.getByLabel("Ghi chú",{exact:true}).inputValue(),"Giữ nội dung khi đổi bước");
    await owner.page.getByRole("button",{name:"Tiếp",exact:true}).click();
    assert.equal(await owner.page.getByLabel("Tên món 1",{exact:true}).inputValue(),"Bữa tối");
    assert.equal(await owner.page.getByLabel("Đơn giá (VND)",{exact:true}).inputValue(),"100001");
    await noHorizontalOverflow(owner.page,project+" split form");
    const expensePost=await observeBrowserPost(owner.page,"/api/groups/"+uiGroupId+"/expenses",
      ()=>owner.page.getByRole("button",{name:"Tạo khoản chi",exact:true}).click());
    assert.equal(expensePost.status(),201,"two-step form must commit a real expense");
    const uiExpenseId=(await expensePost.json()).id;
    await owner.page.waitForURL("**/expenses/"+uiExpenseId);
    await owner.page.getByRole("heading",{name:"RR002 chia tiền lẻ",exact:true}).waitFor();
    await owner.page.getByRole("link",{name:"Các món",exact:true}).click();
    await owner.page.getByText("Bữa tối",{exact:true}).waitFor();
    const stored=await pool.query(
      "SELECT e.total_minor::text,e.notes,(SELECT sum(s.amount_minor)::text FROM expense_items i JOIN expense_item_shares s ON s.item_id=i.id WHERE i.expense_id=e.id) AS shares FROM expenses e WHERE e.id=$1",
      [uiExpenseId]);
    assert.deepEqual(stored.rows[0],{total_minor:"100001",notes:"Giữ nội dung khi đổi bước",shares:"100001"});
    if(project.includes("phone")){
      const viewport=owner.page.viewportSize();
      await owner.page.setViewportSize({width:320,height:844});
      await noHorizontalOverflow(owner.page,project+" narrow screen");
      await capture(owner.page,project,"mobile-expense");
      await owner.page.setViewportSize(viewport);
    }

    const made=await must(owner,"POST","/api/groups",{
      name:"RR002 isolated synthetic group"},201);
    const groupId=made.id;
    assert.match(groupId,/^[0-9a-f-]{36}$/);
    for(const [id,role] of [[other.id,"member"],[admin.id,"admin"]]){
      await pool.query(
        "INSERT INTO group_members(group_id,user_id,role) VALUES($1,$2,$3)",
        [groupId,id,role]);
    }
    await seedHistoricalCycleSettings(pool,groupId,owner.id,day(-20)+"T00:00:00Z");
    // The real session enables bilateral metadata on a historical opt-in;
    // this appends a fresh audit event without changing the activation epoch.
    await must(owner,"PATCH","/api/groups/"+groupId+
      "/settlement-cycle/settings",{
        expectedVersion:1,requestedEnabled:true,
        requestedBilateralNetting:true});
    await owner.page.goto(ORIGIN+"/groups/"+groupId+"/manage?section=cycle");
    await owner.page.getByRole("heading",{name:"Quyết toán",exact:true}).waitFor();
    assert.equal(await owner.page.getByRole("checkbox",{
      name:/Bật quyết toán/
    }).isChecked(),true);
    assert.equal(await owner.page.getByRole("checkbox",{
      name:/Cho phép bù nợ/
    }).isChecked(),true);
    await owner.page.getByText("Chưa kích hoạt",{exact:true}).first().waitFor();
    await noHorizontalOverflow(owner.page,project+" manage");
    await admin.page.goto(ORIGIN+"/groups/"+groupId+"/manage?section=cycle");
    assert.equal(await admin.page.getByRole("heading",{
      name:"Quyết toán",exact:true}).count(),0,
      "Group admin cannot manage cycle rights without explicit delegation");

    // Backdated manual schedule is a synthetic CI-only fixture. The real
    // settings/schedule validation still rejects such a request in production.
    const revision=randomUUID();
    await pool.query(
      "INSERT INTO group_settlement_schedule_heads(group_id,updated_by) VALUES($1,$2)",
      [groupId,owner.id]);
    await pool.query(
      "INSERT INTO group_settlement_schedule_revisions "+
      "(id,group_id,version,frequency,time_zone,anchor_date,effective_at,created_by) "+
      "VALUES($1,$2,1,'manual','UTC',$3,$4,$5)",
      [revision,groupId,day(-14),day(-14)+"T00:00:00Z",owner.id]);

    const cyclesApi=apiFor(groupId);
    const created=await must(owner,"POST",cyclesApi,{
      expectedScheduleVersion:1,requestKey:randomUUID(),
      startDate:day(-10),endDate:day(-6)},201);
    const cycleId=created.cycle.id;
    const detail=pathFor(groupId,cycleId);
    await must(owner,"POST",cyclesApi+"/"+cycleId+"/review",
      {expectedVersion:1});
    const draft=(title,payerId,debtorId,amount)=>({
      title,occurredOn:day(-8),payerId,
      items:[{name:"Synthetic expense",quantity:1,
        unitPriceMinor:String(amount),participants:[debtorId]}],
    });
    await must(owner,"POST","/api/groups/"+groupId+"/expenses",
      draft("RR002 owner-paid dinner",owner.id,other.id,130000),201);
    await must(other,"POST","/api/groups/"+groupId+"/expenses",
      draft("RR002 counterparty-paid groceries",other.id,owner.id,100000),201);

    // Actual signed-browser stale fingerprint: the owner reads a REVIEW
    // preview, while another original invoice is added before confirmation.
    await owner.page.goto(ORIGIN+detail);
    await owner.page.getByRole("heading",{name:"Kiểm tra số liệu"}).waitFor();
    await owner.page.getByRole("button",{
      name:"Kiểm tra số liệu"}).click();
    await owner.page.getByText("Chưa chốt").waitFor();
    const lock=owner.page.getByRole("button",{
      name:"Chốt số liệu"});
    assert.equal(await lock.isDisabled(),true,"Lock must require explicit consent");
    await must(owner,"POST","/api/groups/"+groupId+"/expenses",
      draft("RR002 stale review new invoice",owner.id,other.id,20000),201);
    await seedSyntheticSources(groupId,owner.id,other.id,day(-9));
    // Install before the checkbox receives focus so the probe sees the
    // entire focus transition leading into the button's pointer gesture.
    await installSnapshotPointerProbe(owner.page);
    await owner.page.getByRole("checkbox",{
      name:/Tôi đã kiểm tra số liệu/
    }).check();
    // The fixed nav must stay stable during checkbox->button focus changes,
    // including desktop and device-emulated pointer interactions.
    assert.notEqual(await owner.page.locator(".app-bottom-nav")
      .evaluate(el=>getComputedStyle(el).display),"none",
      "Bottom navigation must not toggle off on consent checkbox focus");
    // Observe the actual POST response rather than guessing from an
    // unrelated alert. Playwright's click() waits for input dispatch, NOT
    // the async fetch() or React state commit after HTTP 409.
    const snapshotPath=apiFor(groupId,cycleId)+"/snapshot";
    let dispatched=0;
    const recordSnapshotRequest=request=>{
      if(request.method()==="POST"&&
        new URL(request.url()).pathname===snapshotPath)dispatched++;
    };
    owner.page.on("request",recordSnapshotRequest);
    const jsErrors=[];
    const recordPageError=error=>{
      jsErrors.push(String(error?.name??"Error")+": "+
        String(error?.message??"unknown").slice(0,180));
    };
    owner.page.on("pageerror",recordPageError);
    // Count REAL DOM click dispatches, without replacing or invoking React's
    // handler. A browser that sees a native click but sends no HTTP POST
    // has a different problem from Playwright never delivering the click.
    await owner.page.evaluate(()=>{
      globalThis.__rr002LockClickCount=0;
      document.addEventListener("click",event=>{
        const el=event.target;
        if(el instanceof Element&&el.closest("button")?.textContent
          ?.includes("Chốt số liệu"))
          globalThis.__rr002LockClickCount++;
      },true);
    });
    let staleResponse;
    try{
      assert.equal(await lock.isEnabled(),true,
        "consented snapshot lock button must become enabled");
      staleResponse=await observeBrowserPost(
        owner.page,snapshotPath,()=>lock.click({timeout:8000}),10000);
    }catch(error){
      // All values are browser capabilities, control state or synthetic-only
      // frontend errors. Do NOT log request headers, tokens or finance data.
      const diagnostic=await owner.page.evaluate(()=>({
        nativeClicks:globalThis.__rr002LockClickCount??0,
        secureContext:globalThis.isSecureContext,
        randomUUID:typeof globalThis.crypto?.randomUUID,
        buttonTexts:[...document.querySelectorAll("button")].map(el=>
          el.textContent?.trim()).filter(text=>text?.includes("Chốt số liệu")||
            text?.includes("Đang khóa")).slice(0,2),
      })).catch(()=>({nativeClicks:"unknown",secureContext:"unknown",
        randomUUID:"unknown",buttonTexts:[]}));
      const previewVisible=await owner.page.getByText(
        "Chưa chốt").isVisible().catch(()=>false);
      const buttonVisible=await lock.isVisible().catch(()=>false);
      const consent=await owner.page.getByRole("checkbox",{
        name:/Tôi đã kiểm tra số liệu/
      }).isChecked().catch(()=>false);
      const alerts=await owner.page.getByRole("alert").allInnerTexts()
        .catch(()=>[]);
      const pointerProbe=await owner.page.evaluate(()=>
        globalThis.__rr002PointerProbe?.snapshot()??null).catch(()=>null);
      throw new Error("RR-002 snapshot click/POST failed: dispatched="+
        dispatched+", nativeClicks="+diagnostic.nativeClicks+
        ", secureContext="+diagnostic.secureContext+
        ", crypto.randomUUID="+diagnostic.randomUUID+
        ", buttonLabels="+JSON.stringify(diagnostic.buttonTexts)+
        ", buttonVisible="+buttonVisible+", previewVisible="+
        previewVisible+", consent="+consent+
        ", alerts="+JSON.stringify(alerts.map(x=>x.slice(0,180)).slice(0,2))+
        ", pageErrors="+JSON.stringify(jsErrors.slice(0,3))+
        ", pointerProbe="+JSON.stringify(pointerProbe)+
        "; underlying="+String(error?.message??error).slice(0,1400));
    }finally{
      owner.page.off("request",recordSnapshotRequest);
      owner.page.off("pageerror",recordPageError);
      await owner.page.evaluate(()=>
        globalThis.__rr002PointerProbe?.stop()).catch(()=>{});
    }
    // Regression for the exact observed bug: the browser's pointerdown
    // reached the lock button, but focusout re-displayed fixed z-40 nav and
    // pointerup hit that nav. Response alone must not hide a click regression.
    const clickEvidence=await owner.page.evaluate(()=>
      globalThis.__rr002PointerProbe?.snapshot()??null);
    const lockPointerEvents=clickEvidence?.events.filter(event=>
      ["pointerdown","pointerup","click"].includes(event.type)&&
      event.target==="lock-button")??[];
    for(const type of ["pointerdown","pointerup","click"]){
      assert.ok(lockPointerEvents.some(event=>event.type===type),
        "RR-002 lock gesture must deliver "+type+
        " to the real button; "+JSON.stringify(clickEvidence));
    }
    assert.ok(!clickEvidence.events.some(event=>
      ["pointerup","click"].includes(event.type)&&
      event.target==="bottom-nav"),
      "Fixed navigation must never steal lock gesture");
    assert.equal(staleResponse.status(),409,
      "stale original obligations MUST cause a snapshot-lock HTTP 409");
    // A rejected fingerprint must make the entire preview/consent UI
    // disappear and show the specific server error before permitting retry.
    await owner.page.getByText(
      "Chưa chốt").waitFor({state:"hidden",timeout:10000});
    await owner.page.getByRole("alert").filter({
      hasText:/Số liệu hóa đơn hoặc thanh toán đã thay đổi/
    }).waitFor();
    assert.equal(await owner.page.getByRole("checkbox",{
      name:/Tôi đã kiểm tra số liệu/
    }).count(),0,"a stale preview must also revoke the consent checkbox");
    let state=(await must(owner,"GET",cyclesApi+"/"+cycleId+"/snapshot")).snapshot;
    assert.equal(state.state,"review","stale fingerprint must never lock");
    await owner.page.getByRole("button",{
      name:"Kiểm tra số liệu"}).click();
    await owner.page.getByText("Chưa chốt").waitFor();
    const freshConsent=owner.page.getByRole("checkbox",{
      name:/Tôi đã kiểm tra số liệu/
    });
    const freshLock=owner.page.getByRole("button",{
      name:"Chốt số liệu"});
    // The same money authorization must work without a mouse: focus the
    // checkbox, press Space, Tab to the button and press Enter. Mobile
    // emulations retain their ordinary user pointer/touch click flow;
    // hardware keyboard acceptance is separately tested on real devices.
    if(!project.includes("phone")){
      await freshConsent.focus();
      assert.equal(await freshConsent.isChecked(),false,
        "fresh preview must revoke prior authorization");
      await owner.page.keyboard.press("Space");
      assert.equal(await freshConsent.isChecked(),true,
        "Space must explicitly check snapshot consent");
      await owner.page.keyboard.press("Tab");
      let lockHasFocus=await freshLock.evaluate(
        el=>el===document.activeElement);
      // On macOS Playwright WebKit intentionally follows Safari's system
      // Keyboard Navigation preference. With the default policy plain Tab
      // can skip native <button>s; Option+Tab includes all form controls.
      // Use that REAL keyboard path only when standard Tab did not land
      // on the button; do not add tabindex, force focus or click the button.
      if(!lockHasFocus&&project==="webkit-desktop"&&process.platform==="darwin"){
        await freshConsent.focus();
        await owner.page.keyboard.press("Alt+Tab");
        lockHasFocus=await freshLock.evaluate(
          el=>el===document.activeElement);
      }
      if(!lockHasFocus){
        const focused=await owner.page.evaluate(()=>{
          const el=document.activeElement;
          return {tag:el?.tagName?.toLowerCase()??"none",
            type:el?.getAttribute?.("type")??null,
            role:el?.getAttribute?.("role")??null};
        });
        assert.fail("Keyboard focus must reach the snapshot lock button "+
          "via Tab or native macOS WebKit Option+Tab; project="+project+
          ", host="+process.platform+", actual="+JSON.stringify(focused));
      }
      const lockedResponse=await observeBrowserPost(owner.page,snapshotPath,
        ()=>owner.page.keyboard.press("Enter"));
      assert.equal(lockedResponse.status(),200,
        "keyboard Enter must commit a fresh authorized snapshot lock");
    }else{
      await freshConsent.check();
      const lockedResponse=await observeBrowserPost(owner.page,snapshotPath,
        ()=>freshLock.click());
      assert.equal(lockedResponse.status(),200,
        "mobile pointer confirmation must commit the real snapshot lock");
    }
    await owner.page.getByText("Đã chốt số liệu",{exact:true}).first().waitFor();
    state=(await must(owner,"GET",cyclesApi+"/"+cycleId+"/snapshot")).snapshot;
    assert.equal(state.state,"locked");
    assert.equal(state.obligationCount,55,"50-row UI must not truncate underlying ledger");
    const startingMoney=await originalBalance(groupId);
    assert.equal(startingMoney.obligations,55);
    assert.equal(startingMoney.noncash_docs,0);
    assert.equal(startingMoney.cash_requests,0);

    // Server-rendered original source links; live totals are identical on
    // page 1 and page 2, never recomputed from 50 visible rows.
    await owner.page.goto(ORIGIN+detail+"?view=sources");
    await owner.page.getByRole("heading",{name:"Khoản trong kỳ",exact:true}).first().waitFor();
    const src=owner.page.getByRole("region",{name:"Khoản trong kỳ"});
    await src.getByText("Chi tiết số tiền",{exact:true}).click();
    const totals=await src.locator("dl").first().innerText();
    assert.match(await src.innerText(),/55 khoản nợ/);
    await src.getByRole("link",{name:"Tiếp"}).click();
    await owner.page.waitForURL(/page=2/);
    const page2=owner.page.getByRole("region",{name:"Khoản trong kỳ"});
    await page2.getByText("Trang 2/2",{exact:true}).waitFor();
    if(await page2.locator("details").first().getAttribute("open")===null)
      await page2.getByText("Chi tiết số tiền",{exact:true}).click();
    await page2.locator("dl").first().waitFor({state:"visible"});
    assert.equal(await page2.locator("dl").first().innerText(),totals,
      "Snapshot/live summary must not be reduced by page 2 pagination");
    assert.ok((await page2.getByRole("list",{name:"Nguồn công nợ gốc"}).locator("li").count())>0);
    const firstSource=page2.getByRole("list",{name:"Nguồn công nợ gốc"}).getByRole("link").first();
    await assertTapTarget(firstSource,"original invoice link");
    await page2.getByRole("link",{name:"Trước"}).click();
    await owner.page.waitForURL(url=>url.searchParams.get("page")==="1");

    // Pair dropdown permits selecting exactly one counterparty. The
    // financial call-to-action remains truly disabled, not CSS-only.
    await owner.page.goto(ORIGIN+detail+"?view=settle");
    const selector=owner.page.getByLabel("Chọn người");
    await selector.selectOption({label:other.name});
    await assertTapTarget(selector,"counterparty selector");
    const proposal=owner.page.getByRole("button",{name:"Gửi đề xuất bù nợ"});
    await proposal.waitFor();
    assert.equal(await proposal.isDisabled(),true);
    await assertTapTarget(proposal,"disabled proposal");
    const originals=owner.page.getByRole("button",{
      name:"Xem các khoản bù nợ"});
    await originals.focus();
    await owner.page.keyboard.press("Enter");
    assert.equal(await owner.page.getByRole("button",{name:"Ẩn khoản nợ gốc"}).getAttribute("aria-expanded"),"true");
    await owner.page.getByRole("heading",{name:"Chiều 1"}).waitFor();
    await noHorizontalOverflow(owner.page,project+" locked detail");
    if(project.includes("phone"))await capture(owner.page,project,"locked-cycle");

    // Critical privacy boundary: another group admin is not one of the pair.
    const pairUrl=apiFor(groupId,cycleId)+"/bilateral-proposals"+
      "?partyAId="+encodeURIComponent(owner.id)+
      "&partyBId="+encodeURIComponent(other.id);
    const forbidden=await send(admin,"GET",pairUrl);
    assert.equal(forbidden.response.status(),403,
      "Admin cannot inspect another pair's private bilateral proposal");
    const forbiddenOutsider=await send(outsider,"GET",pairUrl);
    assert.ok([403,404].includes(forbiddenOutsider.response.status()));
    await outsider.page.goto(ORIGIN+detail+"?view=sources");
    assert.equal(await outsider.page.getByRole("heading",{
      name:"Khoản trong kỳ"}).count(),0,
      "Nonmember cannot render financial details by direct deep link");

    // An original pair member opens a dispute with explicit consent;
    // another member must not see its private reason or audit entries.
    const reason="RR002 synthetic invoice split needs two-party reconciliation";
    await owner.page.goto(ORIGIN+detail+"?view=check&panel=disputes");
    await owner.page.getByLabel("Chọn khoản nợ")
      .selectOption({index:1});
    await owner.page.getByLabel("Nội dung").fill(reason);
    const createDisputeButton=owner.page.getByRole("button",{name:"Gửi tranh chấp"});
    assert.equal(await createDisputeButton.isDisabled(),true,
      "Dispute submission must require a separate acknowledgement");
    await owner.page.getByRole("checkbox",{name:/Tôi hiểu tranh chấp không tự hủy nợ/})
      .check();
    const disputesPath=apiFor(groupId,cycleId)+"/disputes";
    const opened=await observeBrowserPost(owner.page,disputesPath,
      ()=>createDisputeButton.click());
    const opening=await opened.json().catch(()=>null);
    assert.equal(opened.status(),201,"opening dispute must commit via signed POST: "+
      JSON.stringify(opening)?.slice(0,180));
    const disputeId=opening?.dispute?.id;
    assert.match(disputeId??"",/^[0-9a-f-]{36}$/i,
      "open dispute response must provide a durable id");
    assert.equal(opening.dispute.reason,reason);
    await owner.page.locator("article").filter({hasText:reason}).first().waitFor();
    const disputeResponse=await must(owner,"GET",disputesPath);
    assert.ok(disputeResponse.disputes.some(x=>x.id===disputeId&&x.reason===reason),
      "committed dispute must be visible to its real reporter");
    const adminDisputes=await must(admin,"GET",apiFor(groupId,cycleId)+"/disputes");
    assert.ok(!adminDisputes.disputes.some(x=>x.id===disputeId),
      "unrelated admin cannot enumerate pair dispute");
    await other.page.goto(ORIGIN+detail+"?view=check&panel=disputes");
    await other.page.getByText(reason).first().waitFor();
    await other.page.getByRole("button",{
      name:"Trả lời"}).click();
    const responseGroup=other.page.getByRole("group",{name:"Phản hồi tranh chấp"});
    await responseGroup.getByLabel("Trả lời")
      .fill("RR002 synthetic counterparty accepts this review");
    const eventsPath=disputesPath+"/"+disputeId+"/events";
    const answered=await observeBrowserPost(other.page,eventsPath,
      ()=>responseGroup.getByRole("button",{
        name:"Gửi"}).click());
    assert.equal(answered.status(),201,
      "counterparty response must persist before reading the event timeline");
    await other.page.getByText("RR002 synthetic counterparty accepts this review")
      .first().waitFor();
    await owner.page.reload();
    await owner.page.getByText(reason).first().waitFor();
    await owner.page.getByRole("button",{
      name:"Đã giải quyết"}).click();
    const resolveGroup=owner.page.getByRole("group",{name:"Phản hồi tranh chấp"});
    await resolveGroup.getByLabel("Trả lời")
      .fill("RR002 mutually reviewed original source");
    const resolved=await observeBrowserPost(owner.page,eventsPath,
      ()=>resolveGroup.getByRole("button",{
        name:"Gửi"}).click());
    assert.equal(resolved.status(),201,
      "reporter resolution must persist before the browser reads the timeline");
    await owner.page.getByText("RR002 mutually reviewed original source")
      .first().waitFor();
    await admin.page.goto(ORIGIN+detail+"?view=check&panel=disputes");
    assert.equal(await admin.page.getByText(reason).count(),0,
      "pair-private dispute text must not leak through unrelated member UI");

    // Controlled network failure is a separate signed browser interaction.
    // This context deliberately disables ONLY Service Worker interception:
    // Playwright documents that page.route cannot reliably see requests
    // handled by an active worker. The main signed browser above still
    // uses real Service Workers for all finance/manifest interactions.
    const offlineContext=await browser.newContext({...options,
      baseURL:ORIGIN,serviceWorkers:"block",
      storageState:await owner.context.storageState()});
    try{
      const offlinePage=await offlineContext.newPage();
      const reconciliationPath=apiFor(groupId,cycleId)+"/reconciliation";
      const matchesReconciliation=url=>
        new URL(url).pathname===reconciliationPath;
      let intercepted=0;
      let requested=0;
      offlinePage.on("request",request=>{
        if(matchesReconciliation(request.url()))requested++;
      });
      await offlinePage.route(matchesReconciliation,async route=>{
        intercepted++;
        await route.abort("failed");
      });
      await offlinePage.goto(ORIGIN+detail+"?view=check");
      const panel=offlinePage.getByRole("region",{
        name:"Kiểm tra & trao đổi"});
      try{
        await panel.getByRole("alert").first().waitFor({timeout:15000});
      }catch(cause){
        const regionPresent=await panel.count();
        const retryCount=await panel.getByRole("button",{name:"Tải lại"})
          .count().catch(()=>0);
        throw new Error("RR-002 controlled offline WebKit failure: "+
          "intercepted="+intercepted+", requested="+requested+
          ", regionPresent="+regionPresent+", retryCount="+retryCount+
          ", signedIn="+!offlinePage.url().includes("/sign-in")+
          ", original="+String(cause?.message??cause).slice(0,600));
      }
      assert.ok(intercepted>0&&requested>0,
        "Error must be caused by real intercepted browser GET, not a "+
        "preexisting alert or unrelated exception");
      assert.ok(!offlinePage.url().includes("/sign-in"),
        "temporary fetch failure must not force a fresh login");
      await offlinePage.unroute(matchesReconciliation);
      await panel.getByRole("button",{name:"Tải lại"}).click();
      await offlinePage.getByRole("heading",{
        name:"Tổng kết"}).waitFor();
      await noHorizontalOverflow(offlinePage,project+" retry");
    }finally{
      await offlineContext.close();
    }
    await owner.page.reload();
    await owner.page.getByRole("heading",{
      name:"Kiểm tra & trao đổi",level:1}).waitFor();
    assert.ok(!owner.page.url().includes("/sign-in"),
      "browser reload must retain persistent session");
    const afterMoney=await originalBalance(groupId);
    assert.deepEqual(afterMoney,startingMoney,
      "RR-002 UI clicks/dispute messages must not create or discharge ledger funds");
    const noFinance=await pool.query(
      "SELECT count(*)::int AS n FROM group_settlement_bilateral_applications WHERE group_id=$1",
      [groupId]);
    assert.equal(noFinance.rows[0].n,0);

    // Real gate, not a finance test flag: exercise the newly admitted group's
    // consent controls with two independent browser sessions in every profile.
    await pool.query('INSERT INTO settlement_cycle_engine_cohort(group_id) VALUES($1)',[groupId]);
    try{
      await pool.query('UPDATE settlement_cycle_engine_control SET enabled=true');
      const openPair=async(user,counterparty)=>{
        await user.page.goto(ORIGIN+detail+"?view=settle");
        assert.equal((await must(user,'GET','/api/groups/'+groupId+'/settlement-cycle/settings')).effectiveEnabled,true);
        await user.page.getByLabel('Chọn người').selectOption({label:counterparty.name});
      };
      const consentPost=async(user,label,path)=>{
        await user.page.getByRole('button',{name:label,exact:true}).click();
        const form=user.page.getByRole('group',{name:label,exact:true});
        const commit=form.getByRole('button',{name:'Xác nhận thao tác',exact:true});
        assert.equal(await commit.isDisabled(),true,'fresh explicit consent is required');
        await form.getByRole('checkbox').check();
        const result=await observeBrowserPost(user.page,path,()=>commit.click());
        assert.equal(result.status(),201,label+' must commit through a real signed browser POST');
        return result.json();
      };
      await openPair(owner,other);
      const proposalPath=apiFor(groupId,cycleId)+'/bilateral-proposals';
      let created=await consentPost(owner,'Gửi đề xuất bù nợ',proposalPath);
      let decisionsPath=proposalPath+'/'+created.proposal.id+'/decisions';
      await consentPost(owner,'Đồng ý bù nợ',decisionsPath);
      await consentPost(owner,'Thu hồi đồng ý',decisionsPath);
      created=await consentPost(owner,'Gửi đề xuất bù nợ',proposalPath);
      assert.equal(created.proposal.version,2,'closed proposal requires a new immutable version');
      decisionsPath=proposalPath+'/'+created.proposal.id+'/decisions';
      await consentPost(owner,'Đồng ý bù nợ',decisionsPath);
      await openPair(other,owner);
      await consentPost(other,'Đồng ý bù nợ',decisionsPath);
      await openPair(owner,other);
      const applied=await consentPost(owner,'Bù nợ ngay',
        proposalPath+'/'+created.proposal.id+'/applications');
      await owner.page.getByRole('heading',{name:'Đã bù nợ'}).waitFor();
      const cash=await consentPost(owner,'Yêu cầu trả phần còn lại',
        apiFor(groupId,cycleId)+'/bilateral-applications/'+applied.application.id+'/residual');
      assert.equal(cash.status,'pending','requesting CASH never confirms a transfer');
      await other.page.goto(ORIGIN+'/groups/'+groupId+'/settlements/'+cash.id);
      await other.page.getByRole('button',{name:'Xác nhận đã thanh toán',exact:true}).click();
      const confirmed=other.page.waitForResponse(r=>r.request().method()==='PATCH'&&
        new URL(r.url()).pathname==='/api/groups/'+groupId+'/settlements/'+cash.id);
      await other.page.getByRole('button',{name:'Xác nhận',exact:true}).click();
      assert.equal((await confirmed).status(),200,'the actual counterparty confirms synthetic CASH');
      const remaining=await pool.query('SELECT outstanding_minor::text,pending_cash_minor::text FROM bn005_obligation_balances WHERE group_id=$1',[groupId]);
      assert.ok(remaining.rows.every(r=>r.outstanding_minor==='0'&&r.pending_cash_minor==='0'));
      const finished=await originalBalance(groupId);
      assert.equal(finished.obligations,startingMoney.obligations);
      assert.equal(finished.original,startingMoney.original);
      assert.equal(finished.noncash_docs,1);
      assert.equal(finished.cash_requests,1);
      await noHorizontalOverflow(owner.page,project+' activated finance');
    }finally{
      await pool.query('UPDATE settlement_cycle_engine_control SET enabled=false');
      await pool.query('UPDATE settlement_cycle_engine_cohort SET admitted=false WHERE group_id=$1',[groupId]);
    }
    if(project.includes("phone")){
      const manifest=await owner.context.request.get(ORIGIN+"/manifest.webmanifest");
      assert.equal(manifest.status(),200);
      await capture(owner.page,project,"resolved-cycle");
    }
  }catch(error){
    // On a browser assertion failure retain screenshots of ONLY synthetic
    // CI test accounts and invoices. Never capture browser trace/network
    // secrets, auth headers, storageState or real financial information.
    for(let i=0;i<users.length;i++){
      const user=users[i];
      if(!user.page.isClosed()){
        await capture(user.page,project,"failure-actor-"+i).catch(()=>{});
      }
    }
    throw error;
  }finally{
    await Promise.allSettled(users.map(u=>u.context.close()));
    await browser.close();
  }
}

test("RR-002 signed Chromium/WebKit browser interactions on disposable PG17",{
  timeout:1000*60*26,
},async t=>{
  const server=spawn(process.execPath,[
    "node_modules/next/dist/bin/next","start","-p",String(port)
  ],{env:{...process.env,BETTER_AUTH_URL:ORIGIN},
    stdio:["ignore","pipe","pipe"]});
  server.stdout.resume();
  server.stderr.resume();
  try{
    await waitForServer(server);
    const scenarios=[
      ["chromium-desktop",playwright.chromium,{
        viewport:{width:1440,height:900},
      }],
      ["webkit-desktop",playwright.webkit,{
        viewport:{width:1440,height:900},
      }],
      ["iphone-simulator",playwright.webkit,{
        ...playwright.devices["iPhone 13"],
      }],
      ["android-phone-simulator",playwright.chromium,{
        ...playwright.devices["Pixel 7"],
      }],
    ];
    // Four real signups TOTAL, not four for each browser engine. A
    // separate disposable browser establishes legitimate Better Auth
    // sessions once, then each profile imports those signed cookies.
    // Waiting on the actual rate limiter is retained as a fallback.
    const bootstrap=await playwright.chromium.launch({headless:true});
    const actors={};
    try{
      for(const tag of ["owner","counterparty","admin","outsider"]){
        const u=await userFor(bootstrap,{viewport:{width:1280,height:800}},tag);
        try{
          actors[tag]={id:u.id,name:u.name,
            storageState:await u.context.storageState()};
        }finally{
          await u.context.close();
        }
      }
    }finally{await bootstrap.close();}
    // Optional focused local replay while fixing a failing browser.
    // By default every profile still runs; a focused replay is NOT proof
    // that the full RR-002 matrix passes.
    const selected=process.env.RR002_PROFILE?.trim()??"";
    assert.ok(!selected||scenarios.some(([name])=>name===selected),
      "RR002_PROFILE must name one supported browser profile");
    for(const [project,engine,options] of scenarios){
      if(selected&&project!==selected)continue;
      await t.test(project,{timeout:1000*60*6},async()=>{
        await scenario(engine,project,options,actors);
        console.log("RR002 browser PASS: "+project);
      });
    }
  }finally{
    server.kill("SIGTERM");
    await pool.end();
    // Avoid logging credentials or original user financial data.
    if(server.exitCode!==null&&server.exitCode!==0)
      console.warn("RR-002 server exited with code "+server.exitCode);
  }
});
