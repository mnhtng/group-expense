import "server-only";
import type {PoolClient} from "pg";

/** Append-only cycle completion is separate from the immutable LOCKED
 * snapshot (state/version 3). Calls require an EXISTING authorized transaction
 * holding the group's FOR UPDATE lock. Never open a second transaction here.
 *
 * sc031_cycle_ready verifies EVERY original obligation and completion blocker.
 * Concurrent money writers serialize on the same group row. ON CONFLICT
 * ensures idempotent exactly-once recognition and audit history.
 */
export async function recordEligibleCycleCompletions(
  client:PoolClient,groupId:string,cycleIds:string[],triggeredBy:string,
):Promise<string[]>{
  const ids=[...new Set(cycleIds)].sort();
  if(ids.length===0)return [];
  const saved=await client.query<{cycleId:string}>(`
    INSERT INTO group_settlement_cycle_completions
      (cycle_id,group_id,origin,triggered_by)
    SELECT c.id,c.group_id,'automatic',$3
    FROM group_settlement_cycles c
    WHERE c.group_id=$1 AND c.id=ANY($2::uuid[])
      AND c.state='locked' AND c.cancelled_at IS NULL
      AND sc031_cycle_ready(c.group_id,c.id)
    ORDER BY c.id
    ON CONFLICT(cycle_id) DO NOTHING
    RETURNING cycle_id AS "cycleId"
  `,[groupId,ids,triggeredBy]);
  return saved.rows.map(r=>r.cycleId);
}

/** Used only after a confirmed settlement that changed original invoices.
 * Avoid a broad group scan and never finalize unrelated historic periods.
 */
export async function completeCyclesTouchedByExpenses(
  client:PoolClient,groupId:string,expenseIds:string[],triggeredBy:string,
):Promise<string[]>{
  const ids=[...new Set(expenseIds)].sort();
  if(ids.length===0)return [];
  const cycles=await client.query<{cycleId:string}>(`
    SELECT DISTINCT src.cycle_id AS "cycleId"
    FROM group_settlement_cycle_snapshot_expenses src
    JOIN group_settlement_cycles c
      ON c.group_id=src.group_id AND c.id=src.cycle_id
    WHERE src.group_id=$1 AND src.expense_id=ANY($2::uuid[])
      AND c.state='locked' AND c.cancelled_at IS NULL
    ORDER BY src.cycle_id
  `,[groupId,ids]);
  return recordEligibleCycleCompletions(
    client,groupId,cycles.rows.map(r=>r.cycleId),triggeredBy);
}
