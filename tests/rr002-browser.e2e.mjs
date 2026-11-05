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
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {test} from "node:test";

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
const pool=new pg.Pool({connectionString:ONLY_DB,max:4});
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
async function scenario(engine,project,options){
  const browser=await engine.launch({headless:true});
  const users=[];
  const create=async tag=>{
    const u=await userFor(browser,options,tag);
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

    const made=await must(owner,"POST","/api/groups",{
      name:"RR002 isolated synthetic group"},201);
    const groupId=made.id;
    assert.match(groupId,/^[0-9a-f-]{36}$/);
    for(const [id,role] of [[other.id,"member"],[admin.id,"admin"]]){
      await pool.query(
        "INSERT INTO group_members(group_id,user_id,role) VALUES($1,$2,$3)",
        [groupId,id,role]);
    }
    // The real session authorizes group opt-in; money engine remains hard OFF.
    await must(owner,"PATCH","/api/groups/"+groupId+
      "/settlement-cycle/settings",{
        expectedVersion:0,requestedEnabled:true,
        requestedBilateralNetting:true});
    await owner.page.goto(ORIGIN+"/groups/"+groupId+"/manage");
    await owner.page.getByRole("heading",{name:"Chuẩn bị quyết toán theo kỳ"}).waitFor();
    assert.equal(await owner.page.getByRole("checkbox",{
      name:/Đăng ký sử dụng chế độ quyết toán theo kỳ/
    }).isChecked(),true);
    assert.equal(await owner.page.getByRole("checkbox",{
      name:/Cho phép đề xuất bù trừ công nợ hai chiều/
    }).isChecked(),true);
    await owner.page.getByText("Chưa kích hoạt",{exact:true}).first().waitFor();
    await noHorizontalOverflow(owner.page,project+" manage");
    await admin.page.goto(ORIGIN+"/groups/"+groupId+"/manage");
    assert.equal(await admin.page.getByRole("heading",{
      name:"Chuẩn bị quyết toán theo kỳ"}).count(),0,
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
    await pool.query(
      "UPDATE group_settlement_config_events SET recorded_at=$2::timestamptz "+
      "WHERE group_id=$1 AND event_type='settings_changed'",
      [groupId,day(-20)+"T00:00:00Z"]);

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
    await owner.page.getByRole("heading",{name:"Rà soát trước khi khóa"}).waitFor();
    await owner.page.getByRole("button",{
      name:"Xem trước số liệu để đối soát"}).click();
    await owner.page.getByText("Bản xem trước — chưa khóa").waitFor();
    const lock=owner.page.getByRole("button",{
      name:"Xác nhận khóa bản đối soát"});
    assert.equal(await lock.isDisabled(),true,"Lock must require explicit consent");
    await must(owner,"POST","/api/groups/"+groupId+"/expenses",
      draft("RR002 stale review new invoice",owner.id,other.id,20000),201);
    await seedSyntheticSources(groupId,owner.id,other.id,day(-9));
    await owner.page.getByRole("checkbox",{
      name:/Tôi đã kiểm tra số liệu này/
    }).check();
    await lock.click();
    await owner.page.getByRole("alert").first().waitFor();
    assert.equal(await owner.page.getByText(
      "Bản xem trước — chưa khóa").count(),0,
      "409 must invalidate stale review preview");
    let state=(await must(owner,"GET",cyclesApi+"/"+cycleId+"/snapshot")).snapshot;
    assert.equal(state.state,"review","stale fingerprint must never lock");
    await owner.page.getByRole("button",{
      name:"Xem trước số liệu để đối soát"}).click();
    await owner.page.getByText("Bản xem trước — chưa khóa").waitFor();
    await owner.page.getByRole("checkbox",{
      name:/Tôi đã kiểm tra số liệu này/
    }).check();
    await owner.page.getByRole("button",{
      name:"Xác nhận khóa bản đối soát"}).click();
    await owner.page.getByText("Snapshot đã khóa",{exact:true}).first().waitFor();
    state=(await must(owner,"GET",cyclesApi+"/"+cycleId+"/snapshot")).snapshot;
    assert.equal(state.state,"locked");
    assert.equal(state.obligationCount,55,"50-row UI must not truncate underlying ledger");
    const startingMoney=await originalBalance(groupId);
    assert.equal(startingMoney.obligations,55);
    assert.equal(startingMoney.noncash_docs,0);
    assert.equal(startingMoney.cash_requests,0);

    // Server-rendered original source links; live totals are identical on
    // page 1 and page 2, never recomputed from 50 visible rows.
    await owner.page.goto(ORIGIN+detail);
    await owner.page.getByRole("heading",{name:"Công nợ gốc trong kỳ"}).waitFor();
    await owner.page.getByRole("heading",{name:"Quyết toán giữa hai người"}).waitFor();
    const src=owner.page.getByRole("region",{name:"Công nợ gốc trong kỳ"});
    const totals=await src.locator("dl").first().innerText();
    assert.match(await src.innerText(),/toàn bộ 55 nghĩa vụ gốc/);
    await src.getByRole("link",{name:"Tiếp"}).click();
    await owner.page.waitForURL(/page=2/);
    const page2=owner.page.getByRole("region",{name:"Công nợ gốc trong kỳ"});
    assert.equal(await page2.locator("dl").first().innerText(),totals,
      "Snapshot/live summary must not be reduced by page 2 pagination");
    assert.ok((await page2.getByRole("list",{name:"Nguồn công nợ gốc"}).locator("li").count())>0);
    const firstSource=page2.getByRole("list",{name:"Nguồn công nợ gốc"}).getByRole("link").first();
    await assertTapTarget(firstSource,"original invoice link");
    await page2.getByRole("link",{name:"Trước"}).click();
    await owner.page.waitForURL(url=>url.searchParams.get("page")==="1");

    // Pair dropdown permits selecting exactly one counterparty. The
    // financial call-to-action remains truly disabled, not CSS-only.
    const selector=owner.page.getByLabel("Xem công nợ của tôi với");
    await selector.selectOption({label:other.name});
    await assertTapTarget(selector,"counterparty selector");
    const proposal=owner.page.getByRole("button",{name:"Gửi đề xuất bù trừ"});
    await proposal.waitFor();
    assert.equal(await proposal.isDisabled(),true);
    await assertTapTarget(proposal,"disabled proposal");
    const originals=owner.page.getByRole("button",{
      name:"Xem nghĩa vụ gốc dùng để tính bù trừ"});
    await originals.focus();
    await owner.page.keyboard.press("Enter");
    assert.equal(await owner.page.getByRole("button",{name:"Ẩn nghĩa vụ gốc"}).getAttribute("aria-expanded"),"true");
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
    await outsider.page.goto(ORIGIN+detail);
    assert.equal(await outsider.page.getByRole("heading",{
      name:"Công nợ gốc trong kỳ"}).count(),0,
      "Nonmember cannot render financial details by direct deep link");

    // An original pair member opens a dispute with explicit consent;
    // another member must not see its private reason or audit entries.
    const reason="RR002 synthetic invoice split needs two-party reconciliation";
    await owner.page.getByLabel("Chọn nghĩa vụ gốc cần đối soát")
      .selectOption({index:1});
    await owner.page.getByLabel("Lý do (10–500 ký tự)").fill(reason);
    const createDisputeButton=owner.page.getByRole("button",{name:"Gửi tranh chấp"});
    assert.equal(await createDisputeButton.isDisabled(),true,
      "Dispute submission must require a separate acknowledgement");
    await owner.page.getByRole("checkbox",{name:/Tôi hiểu tranh chấp không tự hủy nợ/})
      .check();
    await createDisputeButton.click();
    await owner.page.getByText(reason).first().waitFor();
    const disputeResponse=await must(owner,"GET",apiFor(groupId,cycleId)+"/disputes");
    const disputeId=disputeResponse.disputes.find(x=>x.reason===reason)?.id;
    assert.ok(disputeId,"dispute must be visible to real counterpart only");
    const adminDisputes=await must(admin,"GET",apiFor(groupId,cycleId)+"/disputes");
    assert.ok(!adminDisputes.disputes.some(x=>x.id===disputeId),
      "unrelated admin cannot enumerate pair dispute");
    await other.page.goto(ORIGIN+detail);
    await other.page.getByText(reason).first().waitFor();
    await other.page.getByRole("button",{
      name:"Gửi phản hồi cho người mở tranh chấp"}).click();
    const responseGroup=other.page.getByRole("group",{name:"Phản hồi tranh chấp"});
    await responseGroup.getByLabel("Giải thích/biên bản (5–500 ký tự)")
      .fill("RR002 synthetic counterparty accepts this review");
    await responseGroup.getByRole("button",{
      name:"Ghi nhận vào lịch sử"}).click();
    await other.page.getByText("RR002 synthetic counterparty accepts this review")
      .first().waitFor();
    await owner.page.reload();
    await owner.page.getByText(reason).first().waitFor();
    await owner.page.getByRole("button",{
      name:"Tôi xác nhận đã giải quyết xong"}).click();
    const resolveGroup=owner.page.getByRole("group",{name:"Phản hồi tranh chấp"});
    await resolveGroup.getByLabel("Giải thích/biên bản (5–500 ký tự)")
      .fill("RR002 mutually reviewed original source");
    await resolveGroup.getByRole("button",{
      name:"Ghi nhận vào lịch sử"}).click();
    await owner.page.getByText("RR002 mutually reviewed original source").first().waitFor();
    await admin.page.goto(ORIGIN+detail);
    assert.equal(await admin.page.getByText(reason).count(),0,
      "pair-private dispute text must not leak through unrelated member UI");

    // Controlled network failure must show a retry and never infer logout.
    await owner.page.route("**/settlement-cycle/cycles/*/reconciliation",route=>
      route.abort("failed"));
    await owner.page.reload();
    const panel=owner.page.getByRole("region",{name:"Đối soát và trao đổi"});
    await panel.getByRole("alert").first().waitFor();
    assert.ok(!owner.page.url().includes("/sign-in"),
      "temporary fetch failure must not force a fresh login");
    await owner.page.unroute("**/settlement-cycle/cycles/*/reconciliation");
    await panel.getByRole("button",{name:"Tải lại"}).click();
    await owner.page.getByRole("heading",{name:"Báo cáo đối soát trực tiếp"}).waitFor();
    await noHorizontalOverflow(owner.page,project+" retry");
    await owner.page.reload();
    await owner.page.getByRole("heading",{
      name:"Chi tiết kỳ quyết toán"}).waitFor();
    assert.ok(!owner.page.url().includes("/sign-in"),
      "browser reload must retain persistent session");
    const afterMoney=await originalBalance(groupId);
    assert.deepEqual(afterMoney,startingMoney,
      "RR-002 UI clicks/dispute messages must not create or discharge ledger funds");
    const noFinance=await pool.query(
      "SELECT count(*)::int AS n FROM group_settlement_bilateral_applications WHERE group_id=$1",
      [groupId]);
    assert.equal(noFinance.rows[0].n,0);
    if(project.includes("phone")){
      const manifest=await owner.context.request.get(ORIGIN+"/manifest.webmanifest");
      assert.equal(manifest.status(),200);
      await capture(owner.page,project,"resolved-cycle");
    }
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
    for(const [project,engine,options] of scenarios){
      await t.test(project,{timeout:1000*60*6},async()=>{
        await scenario(engine,project,options);
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
