import {randomUUID} from 'node:crypto';

/** INSERT a historical opt-in for a NEW synthetic group. Never rewrite audit
 * timestamps, disable triggers or bypass the production activation policy. */
export async function seedHistoricalCycleSettings(pool,groupId,actorId,at){
  if(process.env.CI!=="true"||process.env.DATABASE_URL!==
    "postgresql://test:test@localhost:5432/group_expense")
    throw Error("Historical fixture refuses non-disposable database");
  const client=await pool.connect();
  try{
    await client.query("BEGIN");
    await client.query(`INSERT INTO group_settlement_settings
      (group_id,requested_enabled,requested_bilateral_netting,updated_by)
      VALUES($1,true,false,$2)`,[groupId,actorId]);
    await client.query(`INSERT INTO group_settlement_config_events
      (id,group_id,actor_id,event_type,details,recorded_at)
      VALUES($1,$2,$3,'settings_changed',
        '{"before":{"enabled":false,"bilateral":false,"version":0},"after":{"enabled":true,"bilateral":false,"version":1}}',
        $4::timestamptz)`,[randomUUID(),groupId,actorId,at]);
    await client.query("COMMIT");
  }catch(error){await client.query("ROLLBACK");throw error;}
  finally{client.release();}
}
