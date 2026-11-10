import "server-only";
import type {PoolClient} from "pg";
import {SettlementError} from "@/lib/settlements/service";
import {pool} from "@/lib/db/pool";

export type EngineAccess={
  financialEngineEnabled:boolean;
  bilateralEnabled:boolean;
  reason:"enabled"|"paused"|"not-enrolled"|"not-opted-in";
};
type QueryClient=Pick<PoolClient,"query">;

/** Redacted operational state; never returns cohort group identities. */
export async function readEngineRollout(client:QueryClient){
  const r=await client.query<{enabled:boolean;cohortLimit:number;revision:number;admittedGroups:number}>(
    `SELECT enabled,cohort_limit AS "cohortLimit",revision,
      (SELECT count(*)::int FROM settlement_cycle_engine_cohort WHERE admitted) AS "admittedGroups"
     FROM settlement_cycle_engine_control WHERE id=1`);
  return r.rows[0]??{enabled:false,cohortLimit:1,revision:0,admittedGroups:0};
}

/** No cache: operator pause and group opt-out affect the next transaction.
 * Writers already hold the group lock; a shared transaction advisory lock
 * serializes authorization with operator changes without granting UPDATE
 * on the operator-only policy tables.
 */
export async function readEngineAccess(client:QueryClient,groupId:string,
  lock=false):Promise<EngineAccess>{
  if(lock)await client.query("SELECT pg_advisory_xact_lock_shared(250025,1)");
  const r=await client.query<{
    enabled:boolean;admitted:boolean|null;
    requested_enabled:boolean|null;requested_bilateral_netting:boolean|null;
  }>(`SELECT p.enabled,c.admitted,s.requested_enabled,s.requested_bilateral_netting
    FROM settlement_cycle_engine_control p
    JOIN groups g ON g.id=$1 AND g.archived_at IS NULL
    LEFT JOIN settlement_cycle_engine_cohort c ON c.group_id=$1
    LEFT JOIN group_settlement_settings s ON s.group_id=$1
    WHERE p.id=1`,[groupId]);
  const row=r.rows[0];
  const reason=!row?.enabled?"paused":!row.admitted?"not-enrolled":
    !row.requested_enabled?"not-opted-in":"enabled";
  const financialEngineEnabled=reason==="enabled";
  return {financialEngineEnabled,
    bilateralEnabled:financialEngineEnabled&&row?.requested_bilateral_netting===true,
    reason};
}

/** Legacy fixture opt-ins cannot authorize a hosted or developer database. */
export function isolatedFinancialFixture(flag:"SC005_TEST_ONLY"|"BN004_TEST_ONLY"|"BN006_TEST_ONLY"){
  return process.env.CI==="true"&&process.env[flag]==="isolated-pg17"&&
    process.env.DATABASE_URL==="postgresql://test:test@localhost:5432/group_expense";
}

export async function requireEngineAccess(client:QueryClient,groupId:string,
  operation:"SC005_TEST_ONLY"|"BN004_TEST_ONLY"|"BN006_TEST_ONLY"){
  const access=await readEngineAccess(client,groupId,true);
  if(operation==="SC005_TEST_ONLY"?access.financialEngineEnabled:access.bilateralEnabled)return access;
  // Existing fixtures still separately enforce real group opt-in in their DAL.
  if(isolatedFinancialFixture(operation))return access;
  throw new SettlementError(409,"Quyết toán chưa được mở hoặc đã tạm dừng cho nhóm này.");
}

/** Only call after the DAL has authorized access to this group. */
export function getGroupEngineAccess(groupId:string){return readEngineAccess(pool,groupId);}
