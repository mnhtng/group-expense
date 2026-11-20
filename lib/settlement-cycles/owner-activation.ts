import "server-only";
import {randomUUID} from "node:crypto";
import {Pool, type PoolClient} from "pg";
import {pool} from "@/lib/db/pool";
import {SettlementSettingsError} from "@/lib/settlement-cycles/settings";

/**
 * Owner self-service only changes an individual group's rollout admission.
 * The global engine kill switch remains exclusively operator-controlled.
 *
 * This intentionally uses an independent narrowly privileged DB role. Never
 * grant the ordinary application runtime INSERT/UPDATE on the rollout tables.
 * An absent operator credential always fails closed.
 */
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const operatorUrl=process.env.SETTLEMENT_OWNER_ACTIVATION_DATABASE_URL;
let operatorPool:Pool|undefined;

function operatorClientPool():Pool {
  if(!operatorUrl || operatorUrl===process.env.DATABASE_URL)
    throw new SettlementSettingsError(409,
      "Máy chủ chưa cấu hình quyền kích hoạt nhóm. Vui lòng liên hệ người vận hành.");
  operatorPool??=new Pool({connectionString:operatorUrl,max:2,
    idleTimeoutMillis:15_000,connectionTimeoutMillis:5_000});
  return operatorPool;
}

export type OwnerEngineActivationView={
  admitted:boolean;
  globalEnabled:boolean;
  cohortLimit:number;
  admittedGroups:number;
  controlRevision:number;
  operatorConfigured:boolean;
};

/** Owner-only. Never reveal the admitted cohort identities to other members. */
export async function getOwnerEngineActivation(
  groupId:string,actorId:string,
):Promise<OwnerEngineActivationView>{
  if(!uuid.test(groupId))throw new SettlementSettingsError(400,"Mã nhóm không hợp lệ.");
  const r=await pool.query<{
    ownerId:string;admitted:boolean;enabled:boolean;
    cohortLimit:number;admittedGroups:number;revision:number;
  }>(`SELECT g.owner_id AS "ownerId",COALESCE(c.admitted,false) AS admitted,
       p.enabled,p.cohort_limit AS "cohortLimit",p.revision,
       (SELECT count(*)::int FROM settlement_cycle_engine_cohort
        WHERE admitted) AS "admittedGroups"
     FROM groups g
     JOIN group_members m ON m.group_id=g.id AND m.user_id=$2
       AND m.status='active'
     CROSS JOIN settlement_cycle_engine_control p
     LEFT JOIN settlement_cycle_engine_cohort c ON c.group_id=g.id
     WHERE g.id=$1 AND g.archived_at IS NULL AND p.id=1`,[groupId,actorId]);
  const row=r.rows[0];
  if(!row)throw new SettlementSettingsError(404,"Không tìm thấy nhóm đang hoạt động.");
  if(row.ownerId!==actorId)
    throw new SettlementSettingsError(403,"Chỉ chủ nhóm được kích hoạt thanh toán theo kỳ.");
  return {admitted:row.admitted,globalEnabled:row.enabled,
    cohortLimit:row.cohortLimit,admittedGroups:row.admittedGroups,
    controlRevision:row.revision,
    operatorConfigured:!!operatorUrl&&operatorUrl!==process.env.DATABASE_URL};
}

type OwnerActivationInput={
  enabled:boolean;
  expectedAdmitted:boolean;
  expectedControlRevision:number;
};
function validate(input:OwnerActivationInput,groupId:string){
  if(!uuid.test(groupId)||!input||
    typeof input.enabled!=="boolean"||
    typeof input.expectedAdmitted!=="boolean"||
    !Number.isSafeInteger(input.expectedControlRevision)||
    input.expectedControlRevision<1)
    throw new SettlementSettingsError(400,"Yêu cầu kích hoạt nhóm không hợp lệ.");
}

/** The scoped operator credential has only explicit SELECT and cohort
 * INSERT/UPDATE privileges; it cannot mutate global control or finance.
 * Lock order group -> rollout advisory key is owned by the cohort trigger.
 */
export async function setOwnerEngineActivation(
  groupId:string,actorId:string,input:OwnerActivationInput,
):Promise<OwnerEngineActivationView>{
  validate(input,groupId);
  const client:PoolClient=await operatorClientPool().connect();
  try{
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout='5s'");
    await client.query("SET LOCAL statement_timeout='15s'");
    const gr=await client.query<{owner_id:string}>(`SELECT owner_id FROM groups
      WHERE id=$1 AND archived_at IS NULL FOR UPDATE`,[groupId]);
    if(!gr.rows[0])throw new SettlementSettingsError(404,"Nhóm không tồn tại hoặc đã lưu trữ.");
    const membership=await client.query(`SELECT 1 FROM group_members
      WHERE group_id=$1 AND user_id=$2 AND status='active'`,[groupId,actorId]);
    if(gr.rows[0].owner_id!==actorId||!membership.rowCount)
      throw new SettlementSettingsError(403,"Chỉ chủ nhóm được thay đổi quyền thanh toán.");

    const control=await client.query<{enabled:boolean;revision:number;cohortLimit:number}>(
      `SELECT enabled,revision,cohort_limit AS "cohortLimit"
       FROM settlement_cycle_engine_control WHERE id=1`);
    const ctl=control.rows[0];
    if(!ctl||ctl.revision!==input.expectedControlRevision)
      throw new SettlementSettingsError(409,"Chính sách phát hành đã thay đổi. Tải lại trang.");

    const current=await client.query<{admitted:boolean}>(`SELECT admitted
      FROM settlement_cycle_engine_cohort WHERE group_id=$1 FOR UPDATE`,[groupId]);
    const admitted=current.rows[0]?.admitted??false;
    if(admitted!==input.expectedAdmitted)
      throw new SettlementSettingsError(409,"Quyền nhóm đã thay đổi. Vui lòng tải lại.");
    if(admitted===input.enabled) {
      await client.query("COMMIT");
      return getOwnerEngineActivation(groupId,actorId);
    }
    if(input.enabled){
      if(!ctl.enabled)throw new SettlementSettingsError(409,
        "Hệ thống đang tạm dừng Financial Engine. Chủ nhóm không thể tự bật công tắc toàn hệ thống.");
      const settings=await client.query<{requested_enabled:boolean}>(`SELECT requested_enabled
        FROM group_settlement_settings WHERE group_id=$1`,[groupId]);
      if(!settings.rows[0]?.requested_enabled)
        throw new SettlementSettingsError(409,
          "Hãy bật và lưu cấu hình quyết toán của nhóm trước.");
    } else if(ctl.enabled) {
      const count=await client.query<{n:number}>(`SELECT count(*)::int AS n
        FROM settlement_cycle_engine_cohort WHERE admitted`);
      if(count.rows[0]?.n===1)
        throw new SettlementSettingsError(409,
          "Để dừng thanh toán ngay, tắt 'Bật quyết toán' của nhóm. Việc rời cohort cuối cùng yêu cầu operator tạm dừng engine.");
    }
    if(current.rows.length){
      await client.query(`UPDATE settlement_cycle_engine_cohort
        SET admitted=$2 WHERE group_id=$1`,[groupId,input.enabled]);
    } else {
      await client.query(`INSERT INTO settlement_cycle_engine_cohort(group_id,admitted)
        VALUES($1,$2)`,[groupId,input.enabled]);
    }
    await client.query(`INSERT INTO group_settlement_config_events
      (id,group_id,actor_id,event_type,details)
      VALUES($1,$2,$3,'settings_changed',$4::jsonb)`,
      [randomUUID(),groupId,actorId,JSON.stringify({
        subject:"owner_financial_activation",before:admitted,after:input.enabled,
        controlRevision:ctl.revision,
      })]);
    await client.query("COMMIT");
    return getOwnerEngineActivation(groupId,actorId);
  }catch(cause){
    await client.query("ROLLBACK");
    if(cause instanceof SettlementSettingsError)throw cause;
    const error=cause as {code?:string;message?:string};
    if(error.code==="P0001"&&/capacity|limit|cohort/i.test(error.message??""))
      throw new SettlementSettingsError(409,
        "Đã đạt giới hạn số nhóm được kích hoạt. Vui lòng liên hệ người vận hành.");
    if(error.code==="P0001"&&/Pause rollout|final group/i.test(error.message??""))
      throw new SettlementSettingsError(409,
        "Không thể rời cohort cuối khi engine vẫn đang chạy.");
    throw cause;
  }finally{client.release();}
}
