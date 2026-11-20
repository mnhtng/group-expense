import "server-only";
import {Pool} from "pg";
import {pool} from "@/lib/db/pool";
import {SettlementSettingsError} from "@/lib/settlement-cycles/settings";

/**
 * Only an independent limited role can call the SC-027 owner-enrollment
 * function. The ordinary app runtime never gets policy write permissions
 * or the EXECUTE grant on this SECURITY DEFINER function.
 */
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const operatorUrl=process.env.SETTLEMENT_OWNER_ACTIVATION_DATABASE_URL;
let operatorPool:Pool|undefined;

function scopedPool():Pool{
  if(!operatorUrl||operatorUrl===process.env.DATABASE_URL)
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

/** Owner-only; cohort group IDs are never exposed to other groups. */
export async function getOwnerEngineActivation(groupId:string,actorId:string):
  Promise<OwnerEngineActivationView>{
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

/** Executes one audited, group-scoped mutation in an owner-held DB function.
 * Both the Better Auth route and the function check the true group owner.
 * The global operator kill switch remains OFF unless explicitly enabled by
 * a separate operator; owner enrollment can never override it.
 */
export async function setOwnerEngineActivation(
  groupId:string,actorId:string,input:OwnerActivationInput,
):Promise<OwnerEngineActivationView>{
  validate(input,groupId);
  const client=await scopedPool().connect();
  try{
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout='5s'");
    await client.query("SET LOCAL statement_timeout='15s'");

    // Refuse any privileged or misconfigured credential, even if a secret is
    // accidentally set to the database-owner URL under another spelling.
    const state=await client.query<{
      superuser:boolean;createRole:boolean;createDb:boolean;
      memberships:number;globalWrite:boolean;cohortWrite:boolean;
      groupWrite:boolean;userWrite:boolean;moneyWrite:boolean;functionExecute:boolean;
    }>(`SELECT r.rolsuper AS superuser,r.rolcreaterole AS "createRole",
      r.rolcreatedb AS "createDb",
      (SELECT count(*)::int FROM pg_auth_members WHERE member=r.oid) AS memberships,
      has_table_privilege(current_user,'public.settlement_cycle_engine_control','UPDATE') AS "globalWrite",
      has_table_privilege(current_user,'public.settlement_cycle_engine_cohort','UPDATE')
        OR has_table_privilege(current_user,'public.settlement_cycle_engine_cohort','INSERT')
        AS "cohortWrite",
      has_table_privilege(current_user,'public.groups','UPDATE') AS "groupWrite",
      has_table_privilege(current_user,'public."user"','UPDATE') AS "userWrite",
      has_table_privilege(current_user,'public.settlements','INSERT') AS "moneyWrite",
      has_function_privilege(current_user,
        'public.sc027_owner_cohort_change(uuid,text,boolean,boolean,integer)',
        'EXECUTE') AS "functionExecute"
      FROM pg_roles r WHERE r.rolname=current_user`);
    const role=state.rows[0];
    if(!role||role.superuser||role.createRole||role.createDb||
      role.memberships!==0||role.globalWrite||role.cohortWrite||
      role.groupWrite||role.userWrite||role.moneyWrite||!role.functionExecute)
      throw new SettlementSettingsError(409,
        "Tài khoản kích hoạt nhóm chưa đáp ứng quyền truy cập tối thiểu.");

    await client.query(`SELECT public.sc027_owner_cohort_change(
      $1::uuid,$2::text,$3::boolean,$4::boolean,$5::integer)`,
      [groupId,actorId,input.enabled,input.expectedAdmitted,
       input.expectedControlRevision]);
    await client.query("COMMIT");
    return await getOwnerEngineActivation(groupId,actorId);
  }catch(cause){
    await client.query("ROLLBACK");
    if(cause instanceof SettlementSettingsError)throw cause;
    const err=cause as {code?:string;message?:string};
    if(err.code==="P0002")throw new SettlementSettingsError(404,"Không tìm thấy nhóm.");
    if(err.code==="42501")throw new SettlementSettingsError(403,
      "Chỉ chủ nhóm đang hoạt động được phép thay đổi quyền thanh toán.");
    if(err.code==="40001")throw new SettlementSettingsError(409,
      "Trạng thái quyền đã thay đổi. Vui lòng tải lại.");
    if(err.code==="23514"||err.code==="P0001"){
      if(/capacity|limit|cohort/i.test(err.message??""))
        throw new SettlementSettingsError(409,
          "Đã đạt giới hạn số nhóm được kích hoạt.");
      if(/SC027_GROUP_NOT_OPTED_IN/.test(err.message??""))
        throw new SettlementSettingsError(409,
          "Vui lòng bật và lưu cấu hình quyết toán của nhóm trước.");
    }
    throw cause;
  }finally{client.release();}
}
