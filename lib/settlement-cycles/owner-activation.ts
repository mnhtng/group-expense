import "server-only";
import {randomUUID} from "node:crypto";
import {pool} from "@/lib/db/pool";
import {SettlementSettingsError} from "@/lib/settlement-cycles/settings";

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export type OwnerEngineActivationView={
  enabled:boolean;
  emergencyPaused:boolean;
  requestedEnabled:boolean;
  settingsVersion:number;
};

/** Read-only group-owner visibility; the authenticated session must be
 * checked at the route AND this query verifies live ownership. */
export async function getOwnerEngineActivation(
  groupId:string,actorId:string,
):Promise<OwnerEngineActivationView>{
  if(!uuid.test(groupId))throw new SettlementSettingsError(400,"Mã nhóm không hợp lệ.");
  const result=await pool.query<{
    owner_id:string;financial_engine_enabled:boolean|null;
    requested_enabled:boolean|null;version:number|null;emergency_paused:boolean;
  }>(`SELECT g.owner_id,s.financial_engine_enabled,s.requested_enabled,
      s.version,p.emergency_paused
    FROM groups g
    JOIN group_members m ON m.group_id=g.id AND m.user_id=$2 AND m.status='active'
    CROSS JOIN settlement_cycle_engine_control p
    LEFT JOIN group_settlement_settings s ON s.group_id=g.id
    WHERE g.id=$1 AND g.archived_at IS NULL AND p.id=1`,[groupId,actorId]);
  const row=result.rows[0];
  if(!row)throw new SettlementSettingsError(404,"Không tìm thấy nhóm đang hoạt động.");
  if(row.owner_id!==actorId)
    throw new SettlementSettingsError(403,"Chỉ chủ nhóm được bật hoặc tắt thanh toán theo kỳ.");
  return {enabled:row.financial_engine_enabled===true,
    emergencyPaused:row.emergency_paused,
    requestedEnabled:row.requested_enabled===true,
    settingsVersion:row.version??0};
}

type OwnerActivationInput={
  enabled:boolean;
  expectedEnabled:boolean;
  expectedSettingsVersion:number;
};

/** Strict owner-only transaction. No privileged connection, cohort mutation,
 * global policy update, or direct financial ledger write. Both group writes
 * and cash/noncash writers use the same group row lock, so disabling the
 * engine cannot race new financial authorization for this group.
 */
export async function setOwnerEngineActivation(
  groupId:string,actorId:string,input:OwnerActivationInput,
):Promise<OwnerEngineActivationView>{
  if(!uuid.test(groupId)||!input||
    typeof input.enabled!=="boolean"||
    typeof input.expectedEnabled!=="boolean"||
    !Number.isSafeInteger(input.expectedSettingsVersion)||
    input.expectedSettingsVersion<0)
    throw new SettlementSettingsError(400,"Yêu cầu kích hoạt nhóm không hợp lệ.");
  const client=await pool.connect();
  try{
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout='5s'");
    await client.query("SET LOCAL statement_timeout='15s'");
    const group=await client.query<{owner_id:string}>(`SELECT owner_id FROM groups
      WHERE id=$1 AND archived_at IS NULL FOR UPDATE`,[groupId]);
    if(!group.rows[0])throw new SettlementSettingsError(404,"Không tìm thấy nhóm.");
    const member=await client.query(`SELECT 1 FROM group_members
      WHERE group_id=$1 AND user_id=$2 AND status='active'`,[groupId,actorId]);
    if(group.rows[0].owner_id!==actorId||!member.rowCount)
      throw new SettlementSettingsError(403,"Chỉ chủ nhóm đang hoạt động được phép thay đổi quyền thanh toán.");
    const current=await client.query<{
      version:number;requested_enabled:boolean;financial_engine_enabled:boolean;
    }>(`SELECT version,requested_enabled,financial_engine_enabled
      FROM group_settlement_settings WHERE group_id=$1 FOR UPDATE`,[groupId]);
    const row=current.rows[0];
    if(!row||!row.requested_enabled)
      throw new SettlementSettingsError(409,
        "Vui lòng bật và lưu cấu hình quyết toán của nhóm trước.");
    if(row.version!==input.expectedSettingsVersion||
      row.financial_engine_enabled!==input.expectedEnabled)
      throw new SettlementSettingsError(409,
        "Trạng thái quyết toán đã thay đổi. Vui lòng tải lại trang.");
    if(row.financial_engine_enabled!==input.enabled){
      await client.query(`UPDATE group_settlement_settings SET
        financial_engine_enabled=$2,version=version+1,
        updated_at=now(),updated_by=$3 WHERE group_id=$1`,
        [groupId,input.enabled,actorId]);
      await client.query(`INSERT INTO group_settlement_config_events
        (id,group_id,actor_id,event_type,details)
        VALUES($1,$2,$3,'settings_changed',$4::jsonb)`,[
        randomUUID(),groupId,actorId,JSON.stringify({
          subject:"group_financial_engine",
          before:{enabled:row.financial_engine_enabled,version:row.version},
          after:{enabled:input.enabled,version:row.version+1},
        }),
      ]);
    }
    await client.query("COMMIT");
    return await getOwnerEngineActivation(groupId,actorId);
  }catch(cause){
    await client.query("ROLLBACK");
    if(cause instanceof SettlementSettingsError)throw cause;
    throw cause;
  }finally{client.release();}
}
