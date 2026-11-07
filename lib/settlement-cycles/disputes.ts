import "server-only";
import {randomUUID} from "node:crypto";
import {pool} from "@/lib/db/pool";
import type {PoolClient} from "pg";
import {SettlementSettingsError} from "@/lib/settlement-cycles/settings";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fail=(status:400|403|404|409,message:string)=>
  new SettlementSettingsError(status,message);
const check=(...values:string[])=>{
  if(values.some(v=>typeof v!=="string"||!UUID.test(v)))
    throw fail(400,"Mã nhóm, kỳ, nghĩa vụ hoặc yêu cầu không hợp lệ.");
};
const clean=(raw:string,min:number)=>{
  if(typeof raw!=="string"||raw.trim().length<min||raw.trim().length>500)
    throw fail(400,"Lý do hoặc phản hồi không hợp lệ (5–500 ký tự).");
  return raw.trim();
};
type Row={
  id:string;groupId:string;cycleId:string;obligationId:string;
  reporterId:string;counterpartyId:string;reason:string;
  status:"open"|"awaiting_reporter"|"resolved"|"withdrawn";
  createdAt:Date;
};
export type CycleDispute={
  id:string;obligationId:string;reporterId:string;counterpartyId:string;
  reason:string;status:Row["status"];createdAt:string;
  canRespond:boolean;canResolve:boolean;canWithdraw:boolean;
  events:CycleDisputeEvent[];
};
export type CycleDisputeEvent={
  id:string;actorId:string;eventType:"respond"|"resolve"|"withdraw";
  body:string;recordedAt:string;
};
const readSql=`SELECT d.id,d.group_id AS "groupId",d.cycle_id AS "cycleId",
 d.obligation_id AS "obligationId",d.reporter_id AS "reporterId",
 d.counterparty_id AS "counterpartyId",d.reason,
 s.status,d.created_at AS "createdAt"
 FROM group_settlement_cycle_disputes d
 JOIN sc009_dispute_states s ON s.id=d.id`;
async function groupLock(c:PoolClient,groupId:string,actor:string,lock:boolean){
  const r=await c.query(`SELECT 1 FROM groups g
     JOIN group_members m ON m.group_id=g.id
     WHERE g.id=$1 AND g.archived_at IS NULL
       AND m.user_id=$2 AND m.status='active' ${lock?"FOR UPDATE OF g":""}`,
       [groupId,actor]);
  if(!r.rowCount)throw fail(404,"Không tìm thấy nhóm đang hoạt động hoặc thành viên.");
}
async function projection(c:PoolClient,r:Row,actorId:string):Promise<CycleDispute>{
  const result=await c.query<{id:string;actorId:string;
    eventType:CycleDisputeEvent["eventType"];body:string;recordedAt:Date}>(`
    SELECT id,actor_id AS "actorId",event_type AS "eventType",
      body,recorded_at AS "recordedAt" FROM group_settlement_cycle_dispute_events
    WHERE dispute_id=$1 ORDER BY recorded_at,id`,[r.id]);
  return {id:r.id,obligationId:r.obligationId,
    reporterId:r.reporterId,counterpartyId:r.counterpartyId,
    reason:r.reason,status:r.status,createdAt:r.createdAt.toISOString(),
    canRespond:r.status==="open"&&actorId===r.counterpartyId,
    canResolve:r.status==="awaiting_reporter"&&actorId===r.reporterId,
    canWithdraw:(r.status==="open"||r.status==="awaiting_reporter")
      &&actorId===r.reporterId,
    events:result.rows.map(e=>({...e,recordedAt:e.recordedAt.toISOString()}))};
}
async function tx<T>(f:(c:PoolClient)=>Promise<T>){
  const c=await pool.connect();
  try{await c.query("BEGIN");const x=await f(c);await c.query("COMMIT");return x;}
  catch(e){await c.query("ROLLBACK");throw e;}
  finally{c.release();}
}
function sqlError(e:unknown):never{
  if(e instanceof SettlementSettingsError)throw e;
  if(e&&typeof e==="object"&&"code" in e&&
     ["23503","23505","23514","P0001","40001","40P01"].includes(String(e.code)))
    throw fail(409,"Tranh chấp hoặc nghĩa vụ gốc đã thay đổi, vui lòng tải lại.");
  throw e;
}
/** Pair privacy: no manager/admin can read another pair's correspondence. */
export async function listCycleDisputes(groupId:string,cycleId:string,actorId:string){
  check(groupId,cycleId);
  const c=await pool.connect();
  try{
    await c.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await groupLock(c,groupId,actorId,false);
    const result=await c.query<Row>(readSql+
      ` WHERE d.group_id=$1 AND d.cycle_id=$2
         AND $3 IN(d.reporter_id,d.counterparty_id)
       ORDER BY d.created_at DESC,d.id DESC LIMIT 100`,
      [groupId,cycleId,actorId]);
    const disputes=await Promise.all(result.rows.map(r=>projection(c,r,actorId)));
    await c.query("COMMIT");
    return {disputes,limit:100,financialEngineEnabled:false};
  }catch(e){await c.query("ROLLBACK");throw e;}
  finally{c.release();}
}
export async function openCycleDispute(groupId:string,cycleId:string,
  actorId:string,input:{obligationId:string;reason:string;requestKey:string}){
  check(groupId,cycleId,input?.obligationId,input?.requestKey);
  const reason=clean(input?.reason,10);
  try{return await tx(async c=>{
    await groupLock(c,groupId,actorId,true);
    const existing=await c.query<Row>(readSql+
      ` WHERE d.group_id=$1 AND d.reporter_id=$2 AND d.request_key=$3
         FOR UPDATE OF d`,[groupId,actorId,input.requestKey]);
    if(existing.rows[0]){
      const old=existing.rows[0];
      if(old.cycleId!==cycleId||old.obligationId!==input.obligationId||
         old.reason!==reason)throw fail(409,"Mã yêu cầu đã được sử dụng cho tranh chấp khác.");
      return {dispute:await projection(c,old,actorId),alreadyCreated:true};
    }
    const src=await c.query<{debtorId:string;creditorId:string}>(`
      SELECT src.debtor_id AS "debtorId",src.creditor_id AS "creditorId"
      FROM group_settlement_cycle_snapshot_obligations src
      JOIN group_settlement_cycles cy ON cy.id=src.cycle_id
        AND cy.group_id=src.group_id AND cy.state='locked'
      WHERE src.group_id=$1 AND src.cycle_id=$2 AND src.obligation_id=$3`,
      [groupId,cycleId,input.obligationId]);
    const row=src.rows[0];
    if(!row)throw fail(404,"Nghĩa vụ gốc không thuộc kỳ đã khóa.");
    if(actorId!==row.debtorId&&actorId!==row.creditorId)
      throw fail(403,"Chỉ hai người liên quan được mở tranh chấp.");
    const other=actorId===row.debtorId?row.creditorId:row.debtorId;
    const id=randomUUID();
    await c.query(`INSERT INTO group_settlement_cycle_disputes
      (id,group_id,cycle_id,obligation_id,reporter_id,counterparty_id,
       reason,request_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
      [id,groupId,cycleId,input.obligationId,actorId,other,reason,input.requestKey]);
    const result=await c.query<Row>(readSql+" WHERE d.id=$1",[id]);
    return {dispute:await projection(c,result.rows[0],actorId),alreadyCreated:false};
  });}catch(e){return sqlError(e);}
}
export async function actOnCycleDispute(groupId:string,cycleId:string,
  disputeId:string,actorId:string,input:{
    eventType:"respond"|"resolve"|"withdraw";body:string;requestKey:string;
  }){
  check(groupId,cycleId,disputeId,input?.requestKey);
  if(!["respond","resolve","withdraw"].includes(input?.eventType))
    throw fail(400,"Thao tác tranh chấp không hợp lệ.");
  const body=clean(input?.body,5);
  try{return await tx(async c=>{
    await groupLock(c,groupId,actorId,true);
    const current=await c.query<Row>(readSql+
      " WHERE d.id=$1 AND d.group_id=$2 AND d.cycle_id=$3 FOR UPDATE OF d",
      [disputeId,groupId,cycleId]);
    const d=current.rows[0];
    if(!d)throw fail(404,"Không tìm thấy tranh chấp.");
    if(actorId!==d.reporterId&&actorId!==d.counterpartyId)
      throw fail(403,"Không thể hành động thay một trong hai người.");
    const old=await c.query<{actor_id:string;event_type:string;body:string}>(`
      SELECT actor_id,event_type,body
      FROM group_settlement_cycle_dispute_events
      WHERE dispute_id=$1 AND request_key=$2 FOR UPDATE`,
      [disputeId,input.requestKey]);
    if(old.rows[0]){
      const e=old.rows[0];
      if(e.actor_id!==actorId||e.event_type!==input.eventType||e.body!==body)
        throw fail(409,"Mã yêu cầu đã được sử dụng cho hành động khác.");
      return {dispute:await projection(c,d,actorId),alreadyRecorded:true};
    }
    if(!(input.eventType==="respond"&&d.status==="open"&&actorId===d.counterpartyId||
      input.eventType==="resolve"&&d.status==="awaiting_reporter"&&actorId===d.reporterId||
      input.eventType==="withdraw"&&d.status!=="resolved"&&d.status!=="withdrawn"
        &&actorId===d.reporterId))
      throw fail(409,"Trạng thái hoặc người thực hiện không hợp lệ.");
    await c.query(`INSERT INTO group_settlement_cycle_dispute_events
      (id,dispute_id,actor_id,event_type,body,request_key)
      VALUES($1,$2,$3,$4,$5,$6)`,
      [randomUUID(),disputeId,actorId,input.eventType,body,input.requestKey]);
    const currentState=await c.query<Row>(readSql+" WHERE d.id=$1",[disputeId]);
    return {dispute:await projection(c,currentState.rows[0],actorId),alreadyRecorded:false};
  });}catch(e){return sqlError(e);}
}
