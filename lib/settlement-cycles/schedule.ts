import "server-only";
import {randomUUID} from "node:crypto";
import {pool} from "@/lib/db/pool";
import {
  getSettlementSettings,SettlementSettingsError,withAuthorizedCycleManager,
} from "@/lib/settlement-cycles/settings";
import {
  type CycleFrequency,CYCLE_FREQUENCIES,currentLocalDate,
  isPeriodBoundary,localMidnightInstant,validLocalDate,
} from "@/lib/settlement-cycles/calendar";

export type ScheduleRevision={
  id:string;version:number;frequency:CycleFrequency;timeZone:string;
  anchorDate:string;effectiveAt:string;
};
export type ScheduleView={
  version:number;current:ScheduleRevision|null;pending:ScheduleRevision|null;
  canManage:boolean;effectiveEnabled:boolean;
};
export type ScheduleInput={
  expectedVersion:number;
  frequency:CycleFrequency;
  timeZone:string;
  anchorDate:string;
};
type DbRevision={
  id:string;version:number;frequency:CycleFrequency;timeZone:string;
  anchorDate:string;effectiveAt:Date;
};
const q=`
 SELECT id,version,frequency,time_zone AS "timeZone",
   anchor_date::text AS "anchorDate",effective_at AS "effectiveAt"
 FROM group_settlement_schedule_revisions
 WHERE group_id=$1 AND superseded_at IS NULL
 ORDER BY effective_at ASC,version ASC`;

function toView(row:DbRevision):ScheduleRevision {
  return {
    id:row.id,version:row.version,frequency:row.frequency,
    timeZone:row.timeZone,anchorDate:row.anchorDate,
    effectiveAt:row.effectiveAt.toISOString(),
  };
}
function split(rows:DbRevision[],now:number) {
  const current=rows.filter(x=>x.effectiveAt.getTime()<=now).at(-1)??null;
  const future=rows.filter(x=>x.effectiveAt.getTime()>now);
  if(future.length>1)throw new Error("Schedule corruption: multiple future revisions.");
  return {current,pending:future[0]??null};
}
function validated(input:ScheduleInput) {
  if(!input||typeof input!=="object"||
     !Number.isSafeInteger(input.expectedVersion)||input.expectedVersion<0||
     !CYCLE_FREQUENCIES.includes(input.frequency)||
     typeof input.timeZone!=="string"||input.timeZone.length>64||
     !/^[A-Za-z][A-Za-z0-9_+\-]*(?:\/[A-Za-z0-9_+\-]+)*$/.test(input.timeZone)) {
    throw new SettlementSettingsError(400,"Lịch quyết toán hoặc phiên bản không hợp lệ.");
  }
  try {
    validLocalDate(input.anchorDate);
    const effectiveAt=localMidnightInstant(input.anchorDate,input.timeZone);
    // All schedule starts must be a FULL local day in the future.
    if(input.anchorDate<=currentLocalDate(input.timeZone)) {
      throw Error("Ngày bắt đầu phải từ ngày mai trở đi, theo múi giờ đã chọn.");
    }
    return {effectiveAt};
  } catch(error) {
    throw new SettlementSettingsError(400,
      error instanceof Error?error.message:"Ngày hoặc múi giờ không hợp lệ.");
  }
}

export async function getSettlementSchedule(groupId:string,actorId:string):Promise<ScheduleView> {
  // Existing SC-001 access gate: archived/outsider groups are never disclosed.
  const permissions=await getSettlementSettings(groupId,actorId);
  const [head,revs]=await Promise.all([
    pool.query<{version:number}>(
      "SELECT version FROM group_settlement_schedule_heads WHERE group_id=$1",[groupId]),
    pool.query<DbRevision>(q,[groupId]),
  ]);
  const periods=split(revs.rows,Date.now());
  return {
    version:head.rows[0]?.version??0,
    current:periods.current?toView(periods.current):null,
    pending:periods.pending?toView(periods.pending):null,
    canManage:permissions.canManage,
    effectiveEnabled:permissions.effectiveEnabled,
  };
}

/**
 * Future-only edits are serialized using the SAME group row lock as SC-001.
 *
 * A schedule change must occur exactly at a boundary of the running schedule,
 * so it cannot divide a previously established period. New schedule starts
 * exactly at local midnight of its anchor. A timezone change is rejected if
 * these two instants differ, to prevent a gap/overlap across timezones.
 *
 * One future revision is allowed. Editing it supersedes the pending revision;
 * the superseded row and its audit event remain available for forensics.
 */
export async function updateSettlementSchedule(
  groupId:string,actorId:string,input:ScheduleInput,
):Promise<{version:number;current:ScheduleRevision|null;pending:ScheduleRevision}> {
  const {effectiveAt}=validated(input);
  return withAuthorizedCycleManager(groupId,actorId,async client=>{
    const heads=await client.query<{version:number}>(
      "SELECT version FROM group_settlement_schedule_heads WHERE group_id=$1 FOR UPDATE",
      [groupId],
    );
    const headVersion=heads.rows[0]?.version??0;
    if(input.expectedVersion!==headVersion)
      throw new SettlementSettingsError(409,"Lịch đã thay đổi. Tải lại trước khi lưu.");
    const queried=await client.query<DbRevision>(q,[groupId]);
    const {current,pending}=split(queried.rows,Date.now());

    if(pending&&pending.frequency===input.frequency&&
       pending.timeZone===input.timeZone&&
       pending.anchorDate===input.anchorDate) {
      return {
        version:headVersion,
        current:current?toView(current):null,
        pending:toView(pending),
      };
    }

    if(current) {
      // Never alter a running period, including its exact start/end instant.
      const oldLocalToday=currentLocalDate(current.timeZone);
      if(input.anchorDate<=oldLocalToday)
        throw new SettlementSettingsError(400,
          "Lịch mới phải bắt đầu sau ngày hiện tại của múi giờ cũ.");
      if(!isPeriodBoundary(input.anchorDate,current.frequency,current.anchorDate))
        throw new SettlementSettingsError(409,
          "Ngày áp dụng phải nằm đúng đầu kỳ của lịch hiện hành; không được cắt đôi một kỳ.");
      const oldInstant=localMidnightInstant(input.anchorDate,current.timeZone);
      if(oldInstant!==effectiveAt)
        throw new SettlementSettingsError(409,
          "Đổi múi giờ làm lệch thời điểm đầu kỳ. Chọn múi giờ có cùng ranh giới hoặc giữ múi giờ cũ.");
      if(Date.parse(effectiveAt)<=current.effectiveAt.getTime())
        throw new SettlementSettingsError(409,"Không thể thay đổi lịch đã có hiệu lực.");
    }
    // A manually created cycle may extend across the intended cutover.
    // A schedule revision must never split an already persisted cycle,
    // including a cycle created by another delegated manager.
    const intersects=await client.query(
      `SELECT 1 FROM group_settlement_cycles
       WHERE group_id=$1 AND start_at<$2::timestamptz
         AND end_at>$2::timestamptz LIMIT 1`,
      [groupId,effectiveAt],
    );
    if(intersects.rowCount)throw new SettlementSettingsError(409,
      "Không thể thay đổi lịch giữa một kỳ đã tạo. Chọn ranh giới sau khi kỳ kết thúc.");
    // The above guards run INSIDE the transaction after permission+group locks.
    // A planned revision can be replaced, but an active/historical one cannot.
    // Re-check wall-clock time inside the locked transaction. A request that
    // stalls across local midnight must NEVER backdate a schedule change.
    const clock=await client.query<{future:boolean}>(
      "SELECT $1::timestamptz > clock_timestamp() AS future",[effectiveAt],
    );
    if(!clock.rows[0]?.future)throw new SettlementSettingsError(409,
      "Thời điểm áp dụng đã qua. Vui lòng tải lại và chọn ngày khác.");
    if(pending) {
      const retired=await client.query(
        `UPDATE group_settlement_schedule_revisions
         SET superseded_at=clock_timestamp()
         WHERE id=$1 AND superseded_at IS NULL
           AND effective_at>clock_timestamp()`,
        [pending.id],
      );
      if(retired.rowCount!==1)throw new SettlementSettingsError(409,
        "Lịch đang chờ đã bắt đầu. Tải lại trước khi thay đổi.");
    }
    const version=headVersion+1;
    if(!headVersion) {
      await client.query(
        `INSERT INTO group_settlement_schedule_heads(group_id,version,updated_by)
         VALUES($1,$2,$3)`,[groupId,version,actorId],
      );
    }else{
      await client.query(
        `UPDATE group_settlement_schedule_heads SET version=$2,
           updated_by=$3,updated_at=now() WHERE group_id=$1`,
        [groupId,version,actorId],
      );
    }
    const id=randomUUID();
    await client.query(
      `INSERT INTO group_settlement_schedule_revisions
       (id,group_id,version,frequency,time_zone,anchor_date,effective_at,created_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
      [id,groupId,version,input.frequency,input.timeZone,input.anchorDate,
        effectiveAt,actorId],
    );
    const next:ScheduleRevision={
      id,version,frequency:input.frequency,timeZone:input.timeZone,
      anchorDate:input.anchorDate,effectiveAt,
    };
    await client.query(
      `INSERT INTO group_settlement_schedule_events
       (id,group_id,schedule_revision_id,actor_id,event_type,
        previous_revision_id,details)
       VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)`,
      [randomUUID(),groupId,id,actorId,pending?"schedule_replaced":current?"schedule_revised":"schedule_created",
       pending?.id??current?.id??null,
       JSON.stringify({before:pending?toView(pending):current?toView(current):null,
         after:next,headVersion,previousCutoverUnchanged:!!current})],
    );
    return {version,current:current?toView(current):null,pending:next};
  });
}
