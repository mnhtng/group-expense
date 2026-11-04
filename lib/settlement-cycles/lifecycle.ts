import "server-only";

import {randomUUID} from "node:crypto";
import type {PoolClient} from "pg";
import {pool} from "@/lib/db/pool";
import {
  getSettlementSettings,SettlementSettingsError,withAuthorizedCycleManager,
} from "@/lib/settlement-cycles/settings";
import {
  currentLocalDate,localMidnightInstant,periodContaining,validLocalDate,
  type CycleFrequency,
} from "@/lib/settlement-cycles/calendar";

/** SC-003 stores calendar metadata ONLY. No financial ledger is read or written.
 * OPEN -> REVIEW is the only transition; locking/reconciliation belongs to
 * SC-004 and later. Never infer actual engine readiness from a saved opt-in.
 */
export type CycleState="open"|"review"|"locked";
export type CycleSource="scheduled"|"manual";
export type CycleRecord={
  id:string;groupId:string;scheduleRevisionId:string;
  source:CycleSource;periodStart:string;periodEnd:string;
  timeZone:string;startAt:string;endAt:string;state:CycleState;
  version:number;reviewedAt:string|null;createdBy:string|null;
};
type RawCycle=Omit<CycleRecord,"startAt"|"endAt"|"reviewedAt"> & {
  startAt:Date;endAt:Date;reviewedAt:Date|null;
};
type Rule={
  id:string;frequency:CycleFrequency;timeZone:string;
  anchorDate:string;effectiveAt:Date;version:number;
};
type ManualInput={
  expectedScheduleVersion:number;requestKey:string;
  startDate:string;endDate:string;
};
type CycleWork={created:number;reviewed:number;disabled:boolean};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const error=(status:400|403|404|409,message:string)=>
  new SettlementSettingsError(status,message);
const qCycle=`SELECT id,group_id AS "groupId",
  schedule_revision_id AS "scheduleRevisionId",
  source,period_start::text AS "periodStart",period_end::text AS "periodEnd",
  time_zone AS "timeZone",start_at AS "startAt",end_at AS "endAt",
  state,version,reviewed_at AS "reviewedAt",created_by AS "createdBy"
  FROM group_settlement_cycles`;
function publicCycle(c:RawCycle):CycleRecord {
  return {...c,startAt:c.startAt.toISOString(),endAt:c.endAt.toISOString(),
    reviewedAt:c.reviewedAt?.toISOString()??null};
}
function assertUuid(id:string) {
  if(typeof id!=="string"||!uuid.test(id))throw error(400,"Mã không hợp lệ.");
}
function assertActiveOptIn(value:boolean) {
  if(!value)throw error(409,
    "Nhóm chưa bật chuẩn bị quyết toán theo kỳ. Không thể tạo hoặc chuyển trạng thái kỳ.");
}
async function isEnabled(client:PoolClient,groupId:string):Promise<boolean>{
  const r=await client.query<{requested_enabled:boolean}>(
    "SELECT requested_enabled FROM group_settlement_settings WHERE group_id=$1",
    [groupId]);
  return r.rows[0]?.requested_enabled===true;
}
/**
 * Latest OFF -> ON audit event is the only authority for the current opt-in
 * window. Manual or scheduled cycles must NOT begin before that instant.
 * This prevents retroactive import after disabling and later re-enabling.
 */
async function activationEpoch(client:PoolClient,groupId:string):Promise<number>{
  const activated=await client.query<{recorded_at:Date}>(
    `SELECT recorded_at FROM group_settlement_config_events
      WHERE group_id=$1 AND event_type='settings_changed'
        AND details->'before'->>'enabled'='false'
        AND details->'after'->>'enabled'='true'
      ORDER BY recorded_at DESC,id DESC LIMIT 1`,
    [groupId],
  );
  const since=activated.rows[0]?.recorded_at?.getTime();
  if(since===undefined)throw error(409,
    "Không có mốc kích hoạt được ghi nhận. Tạm dừng sinh kỳ để bảo toàn lịch sử.");
  return since;
}
async function versions(client:PoolClient,groupId:string) {
  const head=await client.query<{version:number}>(
    "SELECT version FROM group_settlement_schedule_heads WHERE group_id=$1",
    [groupId]);
  const rules=await client.query<Rule>(
    `SELECT id,version,frequency,time_zone AS "timeZone",
      anchor_date::text AS "anchorDate",effective_at AS "effectiveAt"
      FROM group_settlement_schedule_revisions
      WHERE group_id=$1 AND superseded_at IS NULL
      ORDER BY effective_at,id`,[groupId]);
  return {version:head.rows[0]?.version??0,rules:rules.rows};
}
function selected(rules:Rule[],now:number) {
  const idx=rules.findLastIndex(r=>r.effectiveAt.getTime()<=now);
  if(idx===-1)return {active:null,next:rules[0]??null};
  return {active:rules[idx],next:rules[idx+1]??null};
}
async function audit(client:PoolClient,cycle:RawCycle,initiator:"member"|"cron",
  actorId:string|null,event:"created"|"review_requested",details:Record<string,unknown>) {
  await client.query(
    `INSERT INTO group_settlement_cycle_events
      (id,group_id,cycle_id,event_type,initiator,actor_id,from_state,
       to_state,cycle_version,details)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)`,
    [randomUUID(),cycle.groupId,cycle.id,event,initiator,actorId,
      event==="created"?null:"open",
      event==="created"?"open":"review",
      event==="created"?1:2,JSON.stringify(details)],
  );
}
/** A group row lock is held by ALL callers before this function runs. */
async function addCycle(
  client:PoolClient,groupId:string,rule:Rule,source:CycleSource,
  startDate:string,endDate:string,actorId:string|null,requestKey:string|null,
):Promise<RawCycle> {
  const startAt=localMidnightInstant(startDate,rule.timeZone);
  const endAt=localMidnightInstant(endDate,rule.timeZone);
  if(Date.parse(startAt)>=Date.parse(endAt))
    throw error(400,"Ranh giới kỳ không hợp lệ.");
  const overlap=await client.query(
    `SELECT 1 FROM group_settlement_cycles
       WHERE group_id=$1 AND tstzrange(start_at,end_at,'[)')
          && tstzrange($2::timestamptz,$3::timestamptz,'[)')
       LIMIT 1`,[groupId,startAt,endAt]);
  if(overlap.rowCount)throw error(409,"Kỳ quyết toán giao nhau với một kỳ đã tồn tại.");
  const id=randomUUID();
  const result=await client.query<RawCycle>(
    `INSERT INTO group_settlement_cycles
      (id,group_id,schedule_revision_id,source,period_start,period_end,time_zone,
       start_at,end_at,created_by,request_key)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      RETURNING id,group_id AS "groupId",schedule_revision_id AS "scheduleRevisionId",
        source,period_start::text AS "periodStart",period_end::text AS "periodEnd",
        time_zone AS "timeZone",start_at AS "startAt",end_at AS "endAt",
        state,version,reviewed_at AS "reviewedAt",created_by AS "createdBy"`,
    [id,groupId,rule.id,source,startDate,endDate,rule.timeZone,
      startAt,endAt,actorId,requestKey],
  );
  const cycle=result.rows[0];
  await audit(client,cycle,actorId?"member":"cron",actorId,"created",{
    source,periodStart:startDate,periodEnd:endDate,scheduleRevisionId:rule.id,
  });
  return cycle;
}
async function requestReview(client:PoolClient,cycle:RawCycle,actorId:string|null,
  initiator:"member"|"cron"):Promise<RawCycle>{
  if(cycle.state!=="open")throw error(409,"Kỳ không còn ở trạng thái Đang mở.");
  const result=await client.query<RawCycle>(
    `UPDATE group_settlement_cycles
     SET state='review',version=version+1,
       reviewed_at=clock_timestamp(),updated_at=clock_timestamp()
     WHERE id=$1 AND group_id=$2 AND state='open'
       AND end_at<=clock_timestamp() AND version=$3
     RETURNING id,group_id AS "groupId",schedule_revision_id AS "scheduleRevisionId",
       source,period_start::text AS "periodStart",period_end::text AS "periodEnd",
       time_zone AS "timeZone",start_at AS "startAt",end_at AS "endAt",
       state,version,reviewed_at AS "reviewedAt",created_by AS "createdBy"`,
    [cycle.id,cycle.groupId,cycle.version],
  );
  if(!result.rows[0])throw error(409,"Kỳ chưa kết thúc hoặc đã thay đổi.");
  const updated=result.rows[0];
  await audit(client,updated,initiator,actorId,"review_requested",{
    previousVersion:cycle.version,financialSnapshot:false,
    reviewIsNotApproval:true,
  });
  return updated;
}

export async function listSettlementCycles(groupId:string,actorId:string,
  limit=50):Promise<{cycles:CycleRecord[];canManage:boolean;effectiveEnabled:false}>{
  assertUuid(groupId);
  if(!Number.isInteger(limit)||limit<1||limit>100)
    throw error(400,"Giới hạn danh sách không hợp lệ.");
  const permissions=await getSettlementSettings(groupId,actorId);
  const rows=await pool.query<RawCycle>(
    `${qCycle} WHERE group_id=$1 ORDER BY start_at DESC,id DESC LIMIT $2`,
    [groupId,limit],
  );
  return {cycles:rows.rows.map(publicCycle),canManage:permissions.canManage,
    effectiveEnabled:false};
}

export async function createManualSettlementCycle(groupId:string,actorId:string,
  input:ManualInput):Promise<CycleRecord>{
  assertUuid(groupId);
  if(!input||typeof input!=="object"||
     !Number.isSafeInteger(input.expectedScheduleVersion)||
     input.expectedScheduleVersion<0||
     typeof input.requestKey!=="string"||!uuid.test(input.requestKey))
    throw error(400,"Phiên bản lịch hoặc mã yêu cầu không hợp lệ.");
  try{validLocalDate(input.startDate);validLocalDate(input.endDate);}
  catch{throw error(400,"Ngày bắt đầu hoặc kết thúc không hợp lệ.");}
  if(input.startDate>=input.endDate)
    throw error(400,"Ngày kết thúc phải sau ngày bắt đầu.");
  const days=(Date.parse(input.endDate)-Date.parse(input.startDate))/86_400_000;
  if(days>370)throw error(400,"Kỳ thủ công không được dài quá 370 ngày.");

  return withAuthorizedCycleManager(groupId,actorId,async client=>{
    assertActiveOptIn(await isEnabled(client,groupId));
    const existing=await client.query<RawCycle>(
      `${qCycle} WHERE group_id=$1 AND request_key=$2 FOR UPDATE`,
      [groupId,input.requestKey],
    );
    if(existing.rows[0]){
      const old=existing.rows[0];
      if(old.source==="manual"&&old.createdBy===actorId &&
         old.periodStart===input.startDate&&old.periodEnd===input.endDate)
        return publicCycle(old);
      throw error(409,"Mã yêu cầu đã được dùng cho một kỳ khác.");
    }
    const schedule=await versions(client,groupId);
    if(schedule.version!==input.expectedScheduleVersion)
      throw error(409,"Cấu hình lịch đã thay đổi, hãy tải lại.");
    const now=Date.now();
    const {active,next}=selected(schedule.rules,now);
    if(!active||active.frequency!=="manual")
      throw error(409,"Chỉ có thể tạo kỳ thủ công khi lịch thủ công đã có hiệu lực.");
    if(input.startDate<active.anchorDate)
      throw error(409,"Ngày bắt đầu nằm trước lịch hiện hành.");
    const startAt=localMidnightInstant(input.startDate,active.timeZone);
    const endAt=localMidnightInstant(input.endDate,active.timeZone);
    if(Date.parse(startAt)<await activationEpoch(client,groupId))
      throw error(409,
        "Không thể tạo kỳ bắt đầu trước lần kích hoạt hiện tại của nhóm.");
    if(Date.parse(startAt)<active.effectiveAt.getTime()||Date.parse(startAt)>now)
      throw error(409,"Kỳ phải bắt đầu trong thời gian lịch đã có hiệu lực.");
    if(next&&Date.parse(endAt)>next.effectiveAt.getTime())
      throw error(409,"Kỳ thủ công không được cắt qua lần đổi lịch tiếp theo.");
    return publicCycle(await addCycle(client,groupId,active,"manual",
      input.startDate,input.endDate,actorId,input.requestKey));
  });
}
export async function submitSettlementCycleReview(groupId:string,cycleId:string,
  actorId:string,expectedVersion:number):Promise<CycleRecord>{
  assertUuid(groupId);assertUuid(cycleId);
  if(!Number.isSafeInteger(expectedVersion)||expectedVersion<1)
    throw error(400,"Phiên bản kỳ không hợp lệ.");
  return withAuthorizedCycleManager(groupId,actorId,async client=>{
    assertActiveOptIn(await isEnabled(client,groupId));
    const result=await client.query<RawCycle>(
      `${qCycle} WHERE group_id=$1 AND id=$2 FOR UPDATE`,
      [groupId,cycleId],
    );
    const c=result.rows[0];
    if(!c)throw error(404,"Không tìm thấy kỳ quyết toán.");
    if(c.version!==expectedVersion)
      throw error(409,"Kỳ đã thay đổi. Tải lại trước khi xác nhận.");
    if(c.endAt.getTime()>Date.now())
      throw error(409,"Chưa kết thúc khoảng thời gian của kỳ.");
    return publicCycle(await requestReview(client,c,actorId,"member"));
  });
}

/** Lock + opt-in are checked inside the transaction. No money SQL anywhere.
 * The SC-001 finance release flag remains FALSE for all cycle metadata.
 */
async function workCyclesForGroup(client:PoolClient,groupId:string,cap:number):Promise<CycleWork>{
  if(!(await isEnabled(client,groupId)))
    return {created:0,reviewed:0,disabled:true};
  const nowResult=await client.query<{time:Date}>(
    "SELECT clock_timestamp() AS time");
  const now=nowResult.rows[0].time.getTime();
  const scheduledReview=await client.query<RawCycle>(
    `${qCycle} WHERE group_id=$1 AND source='scheduled' AND state='open'
      AND end_at<=clock_timestamp()
      ORDER BY end_at,id LIMIT $2 FOR UPDATE`,[groupId,cap]);
  let reviewed=0;
  for(const cycle of scheduledReview.rows) {
    await requestReview(client,cycle,null,"cron");
    reviewed++;
  }
  let remaining=cap-reviewed;
  if(remaining<=0)return {created:0,reviewed,disabled:false};

  // Never retroactively attribute a period that began before this group's
  // most recent explicit opt-in (includes disable/re-enable gaps).
  const enabledSince=await activationEpoch(client,groupId);
  const schedules=(await versions(client,groupId)).rules;
  let created=0;
  for(let i=0;i<schedules.length&&remaining>0;i++) {
    const rule=schedules[i];
    if(rule.frequency==="manual"||rule.effectiveAt.getTime()>now)continue;
    const next=schedules[i+1]??null;
    const segmentEnd=next?.effectiveAt.getTime()??Number.POSITIVE_INFINITY;
    const latest=await client.query<{end_at:Date|null}>(
      `SELECT max(end_at) AS end_at
       FROM group_settlement_cycles
       WHERE group_id=$1 AND source='scheduled' AND schedule_revision_id=$2`,
      [groupId,rule.id],
    );
    const lower=Math.max(rule.effectiveAt.getTime(),enabledSince,
      latest.rows[0]?.end_at?.getTime()??0);
    if(lower>=segmentEnd||lower>now)continue;
    const cursor=currentLocalDate(rule.timeZone,lower);
    // Use the SC-002 calendar function, never UTC-day arithmetic.
    let period=periodContaining(cursor,rule.frequency,rule.anchorDate);
    if(!period)throw error(409,"Lịch định kỳ không thể xác định kỳ hợp lệ.");
    while(period&&remaining>0) {
      const startAt=Date.parse(localMidnightInstant(period.start,rule.timeZone));
      const endAt=Date.parse(localMidnightInstant(period.end,rule.timeZone));
      if(startAt<lower) {
        period=periodContaining(period.end,rule.frequency,rule.anchorDate);
        continue;
      }
      if(startAt>now||startAt>=segmentEnd)break;
      if(endAt>segmentEnd)throw error(409,
        "Lịch bị cắt ngang một kỳ. Không sinh kỳ chồng lấn.");
      const c=await addCycle(client,groupId,rule,"scheduled",
        period.start,period.end,null,null);
      created++;remaining--;
      if(endAt<=now&&remaining>0) {
        await requestReview(client,c,null,"cron");
        reviewed++;remaining--;
      }
      if(remaining<=0)break;
      period=periodContaining(period.end,rule.frequency,rule.anchorDate);
    }
  }
  return {created,reviewed,disabled:false};
}

async function transaction<T>(work:(client:PoolClient)=>Promise<T>):Promise<T>{
  const client=await pool.connect();
  try{
    await client.query("BEGIN");
    const result=await work(client);
    await client.query("COMMIT");
    return result;
  }catch(e){await client.query("ROLLBACK");throw e;}
  finally{client.release();}
}

export async function refreshGroupCycleMetadata(groupId:string,actorId:string,
  cap=24):Promise<CycleWork>{
  assertUuid(groupId);
  if(!Number.isInteger(cap)||cap<1||cap>40)
    throw error(400,"Giới hạn xử lý không hợp lệ.");
  return withAuthorizedCycleManager(groupId,actorId,client=>
    workCyclesForGroup(client,groupId,cap));
}

/**
 * CRON_SECRET is verified by the existing internal route before calling.
 * Fair rotation by last checked group avoids starvation on large deployments.
 * Retries are idempotent because group locks + unique period + GiST exclusion
 * are all enforced in the database.
 */
export async function processCycleMetadataCron(maxGroups=30,maxEach=24) {
  if(!Number.isInteger(maxGroups)||maxGroups<1||maxGroups>100||
     !Number.isInteger(maxEach)||maxEach<1||maxEach>40)
    throw error(400,"Giới hạn Cron không hợp lệ.");
  const candidates=await pool.query<{id:string}>(
    `SELECT g.id FROM groups g
     JOIN group_settlement_settings s ON s.group_id=g.id
     LEFT JOIN group_settlement_cycle_cron_checkpoints cp ON cp.group_id=g.id
     WHERE g.archived_at IS NULL AND s.requested_enabled=true
       AND EXISTS(SELECT 1 FROM group_settlement_schedule_revisions r
         WHERE r.group_id=g.id AND r.superseded_at IS NULL
           AND r.effective_at <= clock_timestamp())
     ORDER BY cp.last_checked_at ASC NULLS FIRST,g.id
     LIMIT $1`,[maxGroups]);
  const totals={groups:candidates.rows.length,created:0,reviewed:0,
    skipped:0,errors:0,metadataOnly:true};
  for(const row of candidates.rows){
    let failure=false;
    try{
      const result=await transaction(async client=>{
        const g=await client.query(
          "SELECT 1 FROM groups WHERE id=$1 AND archived_at IS NULL FOR UPDATE",
          [row.id]);
        if(!g.rowCount)return {created:0,reviewed:0,disabled:true};
        return workCyclesForGroup(client,row.id,maxEach);
      });
      totals.created+=result.created;
      totals.reviewed+=result.reviewed;
      if(result.disabled)totals.skipped++;
    }catch(cause){
      failure=true;totals.errors++;
      // Avoid disclosing user IDs, invoices or database details in logs.
      console.error("Cycle metadata polling failed",
        cause instanceof Error?cause.name:"Unknown");
    }
    await pool.query(
      `INSERT INTO group_settlement_cycle_cron_checkpoints
         (group_id,last_checked_at,last_error_at)
       VALUES($1,clock_timestamp(),CASE WHEN $2 THEN clock_timestamp() ELSE NULL END)
       ON CONFLICT(group_id) DO UPDATE SET
         last_checked_at=EXCLUDED.last_checked_at,
         last_error_at=EXCLUDED.last_error_at`,
      [row.id,failure],
    );
  }
  return totals;
}
