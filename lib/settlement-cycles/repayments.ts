import "server-only";
import {createHash,randomUUID} from "node:crypto";
import type {PoolClient} from "pg";
import {pool} from "@/lib/db/pool";
import {notifySettlement} from "@/lib/notifications/service";
import {SETTLEMENT_CYCLE_ENGINE_READY} from "@/lib/settlement-cycles/settings";
import {SettlementError} from "@/lib/settlements/service";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA=/^[0-9a-f]{64}$/;
const MAX_MINOR=9223372036854775807n;
const MAX_ALLOCATIONS=20000;
const err=(status:400|403|404|409,message:string)=>new SettlementError(status,message);

/** The financial feature remains unreleased. Only the private disposable
 * PostgreSQL 17 CI job, using its exact TEST credentials, may exercise the
 * real create/confirm HTTP workflow. There is NO general-purpose env override.
 * Vercel, Neon, production and local developer DBs always fail CLOSED.
 */
export function isBatchRepaymentWritable():boolean{
  return SETTLEMENT_CYCLE_ENGINE_READY ||
    (process.env.CI==="true" &&
     process.env.SC005_TEST_ONLY==="isolated-pg17" &&
     process.env.DATABASE_URL==="postgresql://test:test@localhost:5432/group_expense");
}

export type BatchPairPreview={
  debtorId:string;creditorId:string;
  allocationCount:number;availableMinor:string;pendingMinor:string;
  fingerprint:string;
};
type Source={
  obligationId:string;expenseVersion:number;originalMinor:string;
  debtorId:string;creditorId:string;
  confirmedMinor:string;confirmedCashMinor:string;confirmedSetoffMinor:string;
  pendingMinor:string;availableMinor:string;
};
type CashRow=Source & {isValid:boolean};
type Cycle={id:string;state:string;version:number};
export type CreateCycleBatchInput={
  expectedCycleVersion:number;requestKey:string;
  debtorId:string;creditorId:string;expectedFingerprint:string;
  note?:string;
};
const sourceSql=`
 SELECT o.id AS "obligationId",o.expense_version AS "expenseVersion",
    o.amount_minor::text AS "originalMinor",
    o.debtor_id AS "debtorId",o.creditor_id AS "creditorId",
    (bal.confirmed_cash_minor+bal.confirmed_setoff_minor)::text AS "confirmedMinor",
    bal.confirmed_cash_minor::text AS "confirmedCashMinor",
    bal.confirmed_setoff_minor::text AS "confirmedSetoffMinor",
    bal.pending_cash_minor::text AS "pendingMinor",
    bal.available_minor::text AS "availableMinor",
    (o.voided_at IS NULL AND e.deleted_at IS NULL
      AND o.expense_version=src.expense_version
      AND o.amount_minor=src.original_minor) AS "isValid"
 FROM group_settlement_cycle_snapshot_obligations src
 JOIN obligations o ON o.id=src.obligation_id AND o.group_id=src.group_id
 JOIN expenses e ON e.id=o.expense_id AND e.group_id=o.group_id
 JOIN bn005_obligation_balances bal ON bal.obligation_id=o.id
 WHERE src.cycle_id=$1 AND src.group_id=$2
`;
function canonical(rows:readonly CashRow[],cycleId:string,debtor:string,creditor:string){
  const filtered=rows.filter(r=>r.debtorId===debtor&&r.creditorId===creditor)
    .sort((a,b)=>a.obligationId.localeCompare(b.obligationId,"en"));
  let total=0n,pending=0n,count=0;
  const hash=createHash("sha256").update(JSON.stringify([
    "sc005-pair-v1",cycleId,debtor,creditor,
  ])+"\n");
  const allocations:{obligationId:string;amountMinor:string}[]=[];
  for(const row of filtered){
    const original=BigInt(row.originalMinor);
    const confirmedCash=BigInt(row.confirmedCashMinor);
    const confirmedSetoff=BigInt(row.confirmedSetoffMinor);
    const confirmed=confirmedCash+confirmedSetoff;
    const reserved=BigInt(row.pendingMinor);
    const available=BigInt(row.availableMinor);
    if(!row.isValid||original<=0n||confirmed<0n||reserved<0n||
       available<0n||original-confirmed-reserved!==available){
      throw err(409,"Sổ nghĩa vụ đã thay đổi hoặc công nợ vượt số tiền gốc.");
    }
    // Include zero-available sources in fingerprint, to prevent stale
    // confirmation/pending status being silently ignored on retry.
    hash.update(JSON.stringify([row.obligationId,row.expenseVersion,
      row.originalMinor,row.confirmedCashMinor,row.confirmedSetoffMinor,
      row.pendingMinor,row.availableMinor])+"\n");
    pending+=reserved;
    if(available>0n){
      total+=available;count++;
      allocations.push({obligationId:row.obligationId,amountMinor:available.toString()});
    }
  }
  if(total>MAX_MINOR||count>MAX_ALLOCATIONS)throw err(409,
    "Tổng tiền hoặc số lượng phân bổ vượt giới hạn an toàn, cần chia nhỏ thủ công.");
  return {
    preview:{
      debtorId:debtor,creditorId:creditor,
      allocationCount:count,availableMinor:total.toString(),
      pendingMinor:pending.toString(),fingerprint:hash.digest("hex"),
    } satisfies BatchPairPreview,
    allocations,
  };
}
async function groupGate(client:PoolClient,groupId:string,actorId:string){
  const g=await client.query(
    "SELECT id FROM groups WHERE id=$1 AND archived_at IS NULL FOR UPDATE",[groupId]);
  if(!g.rowCount)throw err(404,"Không tìm thấy nhóm.");
  const m=await client.query(
    "SELECT 1 FROM group_members WHERE group_id=$1 AND user_id=$2 AND status='active'",
    [groupId,actorId]);
  if(!m.rowCount)throw err(404,"Bạn không phải thành viên đang hoạt động.");
}
async function cycleGate(client:PoolClient,groupId:string,cycleId:string,lock:boolean){
  const r=await client.query<Cycle>(
    `SELECT id,state,version FROM group_settlement_cycles
       WHERE id=$1 AND group_id=$2 ${lock?"FOR UPDATE":""}`,
    [cycleId,groupId]);
  if(!r.rows[0])throw err(404,"Không tìm thấy kỳ quyết toán.");
  if(r.rows[0].state!=="locked"||r.rows[0].version!==3)
    throw err(409,"Chỉ kỳ đã khóa snapshot mới có thể yêu cầu thanh toán gộp.");
  const exists=await client.query(
    "SELECT 1 FROM group_settlement_cycle_snapshots WHERE cycle_id=$1 AND group_id=$2",
    [cycleId,groupId]);
  if(!exists.rowCount)throw err(409,"Không tìm thấy snapshot đã khóa.");
}
async function sourceRows(client:PoolClient,cycleId:string,groupId:string,
  pair?:{debtorId:string;creditorId:string},lock=false):Promise<CashRow[]>{
  const params=[cycleId,groupId];
  const condition=pair?
    ' AND src.debtor_id=$3 AND src.creditor_id=$4':"";
  if(pair)params.push(pair.debtorId,pair.creditorId);
  const r=await client.query<CashRow>(sourceSql+condition+
    ` ORDER BY o.id ${lock?"FOR UPDATE OF o":""}`,params);
  return r.rows;
}
async function activePair(client:PoolClient,groupId:string,debtor:string,creditor:string){
  const r=await client.query(
    `SELECT user_id FROM group_members
       WHERE group_id=$1 AND status='active' AND user_id=ANY($2::text[])`,
    [groupId,[debtor,creditor]]);
  if(r.rowCount!==2)throw err(409,
    "Cả người trả và người nhận phải là thành viên đang hoạt động.");
}
async function transaction<T>(fn:(client:PoolClient)=>Promise<T>):Promise<T>{
  const client=await pool.connect();
  try{
    await client.query("BEGIN");
    const res=await fn(client);
    await client.query("COMMIT");
    return res;
  }catch(e){await client.query("ROLLBACK");throw e;}
  finally{client.release();}
}
function assertIds(groupId:string,cycleId:string){
  if(!UUID.test(groupId)||!UUID.test(cycleId))
    throw err(400,"Mã nhóm hoặc kỳ không hợp lệ.");
}

export async function listCycleBatchRepayments(groupId:string,cycleId:string,
  actorId:string):Promise<{pairs:BatchPairPreview[];enabled:boolean;scope:"one_cycle_one_direction"}>{
  assertIds(groupId,cycleId);
  const client=await pool.connect();
  try{
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const allowed=await client.query(
      `SELECT 1 FROM groups g
        JOIN group_members m ON m.group_id=g.id AND m.user_id=$2
          AND m.status='active'
        WHERE g.id=$1 AND g.archived_at IS NULL`,[groupId,actorId]);
    if(!allowed.rowCount)throw err(404,"Không tìm thấy nhóm.");
    await cycleGate(client,groupId,cycleId,false);
    const r=await sourceRows(client,cycleId,groupId);
    const unique=new Map<string,{debtorId:string;creditorId:string}>();
    for(const row of r){
      const key=JSON.stringify([row.debtorId,row.creditorId]);
      if(!unique.has(key))unique.set(key,{debtorId:row.debtorId,creditorId:row.creditorId});
    }
    const pairs=[...unique.values()].map(p=>
      canonical(r,cycleId,p.debtorId,p.creditorId).preview)
      .filter(x=>BigInt(x.availableMinor)>0n)
      .sort((a,b)=>a.debtorId.localeCompare(b.debtorId,"en")||
        a.creditorId.localeCompare(b.creditorId,"en"));
    const flags=await client.query<{requested_enabled:boolean}>(
      "SELECT requested_enabled FROM group_settlement_settings WHERE group_id=$1",
      [groupId],
    );
    await client.query("COMMIT");
    return {pairs,enabled:isBatchRepaymentWritable() &&
      flags.rows[0]?.requested_enabled===true,scope:"one_cycle_one_direction"};
  }catch(e){await client.query("ROLLBACK");throw e;}
  finally{client.release();}
}

export async function createCycleBatchRepayment(groupId:string,cycleId:string,
  actorId:string,input:CreateCycleBatchInput){
  assertIds(groupId,cycleId);
  if(!input||typeof input!=="object"||
    !Number.isSafeInteger(input.expectedCycleVersion)||
    input.expectedCycleVersion!==3||
    !UUID.test(input.requestKey)||!SHA.test(input.expectedFingerprint)||
    typeof input.debtorId!=="string"||!input.debtorId||
    typeof input.creditorId!=="string"||!input.creditorId||
    input.debtorId===input.creditorId||
    typeof (input.note??"")!=="string"||(input.note??"").length>500)
      throw err(400,"Dữ liệu thanh toán gộp không hợp lệ.");
  const note=(input.note??"").trim();
  const reqFingerprint=createHash("sha256").update(JSON.stringify([
    "sc005-request-v1",cycleId,input.debtorId,input.creditorId,
    input.expectedCycleVersion,input.expectedFingerprint,note,
  ])).digest("hex");
  try{return await transaction(async client=>{
    await groupGate(client,groupId,actorId);
    // The true counterparty, not the owner/delegate, must request/confirm.
    if(actorId!==input.debtorId&&actorId!==input.creditorId)
      throw err(403,"Chỉ hai người liên quan mới được đề nghị thanh toán.");
    const previous=await client.query<{id:string;request_fingerprint:string}>(
      `SELECT id,request_fingerprint FROM settlements
       WHERE group_id=$1 AND initiated_by=$2 AND request_key=$3 FOR UPDATE`,
      [groupId,actorId,input.requestKey]);
    if(previous.rows[0]){
      if(previous.rows[0].request_fingerprint!==reqFingerprint)
        throw err(409,"Mã yêu cầu đã được dùng cho giao dịch khác.");
      const scoped=await client.query(
        `SELECT 1 FROM group_settlement_cycle_repayments
         WHERE settlement_id=$1 AND group_id=$2 AND cycle_id=$3
           AND debtor_id=$4 AND creditor_id=$5
           AND preview_fingerprint=$6`,
        [previous.rows[0].id,groupId,cycleId,input.debtorId,
          input.creditorId,input.expectedFingerprint]);
      if(!scoped.rowCount)throw err(409,"Yêu cầu lặp không thuộc đúng kỳ và cặp người.");
      return {id:previous.rows[0].id,alreadyCreated:true,cycleId};
    }
    if(!isBatchRepaymentWritable())throw err(409,
      "Thanh toán gộp theo kỳ chưa được phát hành; dữ liệu và công nợ không thay đổi.");
    const cfg=await client.query<{requested_enabled:boolean}>(
      "SELECT requested_enabled FROM group_settlement_settings WHERE group_id=$1",
      [groupId]);
    if(cfg.rows[0]?.requested_enabled!==true)throw err(409,
      "Nhóm chưa bật chế độ quyết toán theo kỳ.");
    await cycleGate(client,groupId,cycleId,true);
    await activePair(client,groupId,input.debtorId,input.creditorId);
    const rows=await sourceRows(client,cycleId,groupId,{
      debtorId:input.debtorId,creditorId:input.creditorId,
    },true);
    const {preview,allocations}=canonical(rows,cycleId,
      input.debtorId,input.creditorId);
    if(preview.fingerprint!==input.expectedFingerprint)throw err(409,
      "Số dư đã thay đổi. Vui lòng xem lại các nghĩa vụ trước khi yêu cầu.");
    if(!allocations.length)throw err(409,"Không còn khoản tiền khả dụng để thanh toán.");
    const settlementId=randomUUID();
    await client.query(
      `INSERT INTO settlements
       (id,group_id,debtor_id,creditor_id,initiated_by,status,
        amount_minor,request_key,request_fingerprint,note)
       VALUES($1,$2,$3,$4,$5,'pending',$6,$7,$8,$9)`,
      [settlementId,groupId,input.debtorId,input.creditorId,actorId,
        preview.availableMinor,input.requestKey,reqFingerprint,note]);
    // The UNNEST uses exactly two bounded typed arrays, never >65535 SQL
    // parameters. It handles 51, 551 and 10k+ original obligations.
    const inserted=await client.query(
      `INSERT INTO settlement_allocations
        (settlement_id,obligation_id,group_id,debtor_id,creditor_id,amount_minor)
       SELECT $1,alloc.obligation_id,$2,$3,$4,alloc.amount_minor
       FROM unnest($5::uuid[],$6::bigint[]) AS alloc(obligation_id,amount_minor)`,
      [settlementId,groupId,input.debtorId,input.creditorId,
        allocations.map(x=>x.obligationId),allocations.map(x=>x.amountMinor)]);
    if(inserted.rowCount!==allocations.length)
      throw err(409,"Số lượng phân bổ đã ghi không khớp, giao dịch được rollback.");
    await client.query(
      `INSERT INTO group_settlement_cycle_repayments
       (settlement_id,group_id,cycle_id,debtor_id,creditor_id,
        initiated_by,preview_fingerprint,allocation_count,amount_minor)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [settlementId,groupId,cycleId,input.debtorId,input.creditorId,
        actorId,preview.fingerprint,allocations.length,preview.availableMinor]);
    await client.query(
      `INSERT INTO settlement_events
       (id,settlement_id,actor_id,event_type,note)
       VALUES($1,$2,$3,'created',$4)`,
      [randomUUID(),settlementId,actorId,note]);
    await notifySettlement(client,settlementId,actorId,"settlement_requested");
    return {id:settlementId,alreadyCreated:false,cycleId,
      allocationCount:allocations.length,amountMinor:preview.availableMinor,
      status:"pending" as const};
  });}
  catch(e){
    if(e instanceof SettlementError)throw e;
    if(e&&typeof e==="object"&&"code" in e&&
      String(e.code)==="P0001"&&
      "message" in e&&String(e.message).includes("SC-009 disputed source"))
      throw err(409,"Nghĩa vụ gốc đang tranh chấp; không được tạo thanh toán gộp.");
    throw e;
  }
}
