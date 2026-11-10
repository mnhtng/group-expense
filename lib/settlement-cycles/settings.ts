import "server-only";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { pool } from "@/lib/db/pool";
import {readEngineAccess} from "@/lib/settlement-cycles/engine";

/**
 * Group opt-in is distinct from operator-controlled financial rollout.
 * A stored preference alone never authorizes a financial write.
 */

export class SettlementSettingsError extends Error {
  constructor(
    public readonly status: 400 | 403 | 404 | 409,
    message: string,
  ) {
    super(message);
    this.name = "SettlementSettingsError";
  }
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const assertGroupId = (groupId: string) => {
  if (!uuid.test(groupId)) throw new SettlementSettingsError(400, "Mã nhóm không hợp lệ.");
};

export type SettlementSettingsView = {
  version: number;
  requestedEnabled: boolean;
  requestedBilateralNetting: boolean;
  effectiveEnabled: boolean;
  canManage: boolean;
  canDelegate: boolean;
  managerIds: string[];
};

export type SettlementSettingsInput = {
  expectedVersion: number;
  requestedEnabled: boolean;
  requestedBilateralNetting: boolean;
};

function verifyInput(input: SettlementSettingsInput) {
  if (!input || typeof input !== "object" ||
      !Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0 ||
      typeof input.requestedEnabled !== "boolean" ||
      typeof input.requestedBilateralNetting !== "boolean") {
    throw new SettlementSettingsError(400, "Cấu hình hoặc phiên bản không hợp lệ.");
  }
  if (!input.requestedEnabled && input.requestedBilateralNetting) {
    throw new SettlementSettingsError(400, "Phải bật chế độ quyết toán trước khi chọn bù trừ hai chiều.");
  }
}
async function transact<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const value = await work(client);
    await client.query("COMMIT");
    return value;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
async function groupLock(client: PoolClient, groupId: string) {
  assertGroupId(groupId);
  const group = await client.query<{ owner_id: string }>(
    "SELECT owner_id FROM groups WHERE id=$1 AND archived_at IS NULL FOR UPDATE",
    [groupId],
  );
  if (!group.rows[0]) throw new SettlementSettingsError(404, "Không tìm thấy nhóm đang hoạt động.");
  return group.rows[0];
}
async function memberCheck(client: PoolClient, groupId: string, userId: string) {
  const result = await client.query<{ role: string }>(
    "SELECT role FROM group_members WHERE group_id=$1 AND user_id=$2 AND status='active'",
    [groupId, userId],
  );
  if (!result.rows[0]) throw new SettlementSettingsError(404, "Bạn không thuộc nhóm đang hoạt động.");
}
async function activeGrant(client: PoolClient, groupId: string, userId: string) {
  const result = await client.query(
    `SELECT 1 FROM group_settlement_manager_grants
     WHERE group_id=$1 AND user_id=$2 AND revoked_at IS NULL LIMIT 1`,
    [groupId, userId],
  );
  return Boolean(result.rowCount);
}
async function audit(
  client: PoolClient, groupId: string, actorId: string,
  eventType: "settings_changed" | "manager_granted" | "manager_revoked",
  details: Record<string, unknown>,
  subjectId?: string,
) {
  await client.query(
    `INSERT INTO group_settlement_config_events
      (id,group_id,actor_id,subject_user_id,event_type,details)
     VALUES($1,$2,$3,$4,$5,$6::jsonb)`,
    [randomUUID(), groupId, actorId, subjectId ?? null, eventType, JSON.stringify(details)],
  );
}

/** A missing row is guaranteed OFF. Anyone active may read status; only the
 * owner sees the identity of delegated managers.
 */
export async function getSettlementSettings(
  groupId: string, actorId: string,
): Promise<SettlementSettingsView> {
  assertGroupId(groupId);
  const result = await pool.query<{
    ownerId: string; version: number | null;
    requestedEnabled: boolean | null; requestedBilateralNetting: boolean | null;
    delegated: boolean;
  }>(
    `SELECT g.owner_id AS "ownerId",s.version,
       s.requested_enabled AS "requestedEnabled",
       s.requested_bilateral_netting AS "requestedBilateralNetting",
       EXISTS(SELECT 1 FROM group_settlement_manager_grants gr
         WHERE gr.group_id=g.id AND gr.user_id=$2 AND gr.revoked_at IS NULL) AS delegated
     FROM groups g
     JOIN group_members m ON m.group_id=g.id AND m.user_id=$2 AND m.status='active'
     LEFT JOIN group_settlement_settings s ON s.group_id=g.id
     WHERE g.id=$1 AND g.archived_at IS NULL`, [groupId, actorId],
  );
  const row = result.rows[0];
  if (!row) throw new SettlementSettingsError(404, "Không tìm thấy nhóm đang hoạt động.");
  const isOwner = row.ownerId === actorId;
  let managerIds: string[] = [];
  if (isOwner) {
    const managers = await pool.query<{ user_id: string }>(
      `SELECT gr.user_id FROM group_settlement_manager_grants gr
       JOIN group_members gm ON gm.group_id=gr.group_id
         AND gm.user_id=gr.user_id AND gm.status='active'
       WHERE gr.group_id=$1 AND gr.revoked_at IS NULL ORDER BY gr.granted_at,gr.id`,
      [groupId],
    );
    managerIds = managers.rows.map(r => r.user_id);
  }
  return {
    version: row.version ?? 0,
    requestedEnabled: row.requestedEnabled ?? false,
    requestedBilateralNetting: row.requestedBilateralNetting ?? false,
    effectiveEnabled: (await readEngineAccess(pool,groupId)).financialEngineEnabled,
    canManage: isOwner || row.delegated,
    canDelegate: isOwner,
    managerIds,
  };
}

/** Group lock guarantees one writer at a time and protects owner/role changes. */
export async function updateSettlementSettings(
  groupId: string, actorId: string, input: SettlementSettingsInput,
) {
  verifyInput(input);
  return transact(async client => {
    const group = await groupLock(client, groupId);
    await memberCheck(client, groupId, actorId);
    if (group.owner_id !== actorId && !(await activeGrant(client, groupId, actorId))) {
      throw new SettlementSettingsError(403, "Bạn không được quản lý quyết toán theo kỳ.");
    }
    const existing = await client.query<{
      version: number; requested_enabled: boolean; requested_bilateral_netting: boolean;
    }>(
      `SELECT version,requested_enabled,requested_bilateral_netting
       FROM group_settlement_settings WHERE group_id=$1 FOR UPDATE`, [groupId],
    );
    const old = existing.rows[0];
    const version = old?.version ?? 0;
    if (input.expectedVersion !== version) {
      throw new SettlementSettingsError(409, "Cấu hình đã thay đổi. Vui lòng tải lại trước khi lưu.");
    }
    if (old &&
      old.requested_enabled === input.requestedEnabled &&
      old.requested_bilateral_netting === input.requestedBilateralNetting) {
      return { version, requestedEnabled: input.requestedEnabled,
        requestedBilateralNetting: input.requestedBilateralNetting,
        effectiveEnabled:(await readEngineAccess(client,groupId)).financialEngineEnabled };
    }
    const nextVersion = version + 1;
    if (old) {
      await client.query(
        `UPDATE group_settlement_settings SET requested_enabled=$2,
         requested_bilateral_netting=$3,version=$4,updated_by=$5,updated_at=now()
         WHERE group_id=$1`,
        [groupId, input.requestedEnabled, input.requestedBilateralNetting, nextVersion, actorId],
      );
    } else {
      await client.query(
        `INSERT INTO group_settlement_settings
        (group_id,requested_enabled,requested_bilateral_netting,updated_by)
        VALUES($1,$2,$3,$4)`,
        [groupId, input.requestedEnabled, input.requestedBilateralNetting, actorId],
      );
    }
    await audit(client, groupId, actorId, "settings_changed", {
      before: { enabled: old?.requested_enabled ?? false,
        bilateral: old?.requested_bilateral_netting ?? false, version },
      after: { enabled: input.requestedEnabled,
        bilateral: input.requestedBilateralNetting, version: nextVersion },
    });
    return { version: nextVersion, requestedEnabled: input.requestedEnabled,
      requestedBilateralNetting: input.requestedBilateralNetting,
      effectiveEnabled:(await readEngineAccess(client,groupId)).financialEngineEnabled };
  });
}

/** Only the owner can grant/revoke delegation. Admin alone is not privileged. */
export async function updateSettlementManager(
  groupId: string, actorId: string, targetId: string, action: "grant" | "revoke",
) {
  if (typeof targetId !== "string" || !targetId || targetId.length > 256 ||
      (action !== "grant" && action !== "revoke")) {
    throw new SettlementSettingsError(400, "Thành viên hoặc hành động không hợp lệ.");
  }
  return transact(async client => {
    const group = await groupLock(client, groupId);
    await memberCheck(client, groupId, actorId);
    if (actorId !== group.owner_id) {
      throw new SettlementSettingsError(403, "Chỉ chủ nhóm có quyền ủy quyền quản lý kỳ.");
    }
    if (targetId === group.owner_id) {
      throw new SettlementSettingsError(400, "Chủ nhóm đã có sẵn quyền này.");
    }
    const target = await client.query(
      `SELECT 1 FROM group_members
       WHERE group_id=$1 AND user_id=$2 AND status='active'`, [groupId, targetId],
    );
    if (!target.rowCount) {
      throw new SettlementSettingsError(404, "Chỉ có thể cấp quyền cho thành viên đang hoạt động.");
    }
    const previous = await client.query<{ id: string }>(
      `SELECT id FROM group_settlement_manager_grants
       WHERE group_id=$1 AND user_id=$2 AND revoked_at IS NULL FOR UPDATE`,
      [groupId, targetId],
    );
    if (action === "grant") {
      if (previous.rowCount) throw new SettlementSettingsError(409, "Thành viên đã được cấp quyền.");
      await client.query(
        `INSERT INTO group_settlement_manager_grants(id,group_id,user_id,granted_by)
         VALUES($1,$2,$3,$4)`, [randomUUID(), groupId, targetId, actorId],
      );
      await audit(client, groupId, actorId, "manager_granted", { reason: "owner_grant" }, targetId);
    } else {
      if (!previous.rowCount) throw new SettlementSettingsError(409, "Thành viên không có quyền đang hoạt động.");
      await client.query(
        `UPDATE group_settlement_manager_grants SET revoked_by=$3,revoked_at=now()
         WHERE id=$1 AND group_id=$2`, [previous.rows[0].id, groupId, actorId],
      );
      await audit(client, groupId, actorId, "manager_revoked", { reason: "owner_revoke" }, targetId);
    }
    return { memberId: targetId, active: action === "grant" };
  });
}

/**
 * Called INSIDE the membership transaction with the group row already locked.
 * Revoke prior to commit, so neither leave/rejoin nor owner transfer can
 * resurrect delegated rights. Each revoked grant leaves an immutable event.
 */
export async function revokeSettlementManagersWithMembership(
  client: PoolClient, groupId: string, actorId: string,
  reason: "member_departed" | "ownership_transferred", targetId?: string,
) {
  const result = await client.query<{ user_id: string }>(
    `UPDATE group_settlement_manager_grants SET revoked_at=now(),revoked_by=$2
     WHERE group_id=$1 AND revoked_at IS NULL
       AND ($3::text IS NULL OR user_id=$3)
     RETURNING user_id`,
    [groupId, actorId, targetId ?? null],
  );
  for (const row of result.rows) {
    await audit(client, groupId, actorId, "manager_revoked", { reason }, row.user_id);
  }
  return result.rowCount ?? 0;
}

/**
 * Shared SC-001 privilege boundary for SC-002 schedule writes.
 * Group row lock is acquired BEFORE membership, delegation and schedule
 * version checks. Admin status alone is never sufficient.
 */
export async function withAuthorizedCycleManager<T>(
  groupId:string,actorId:string,work:(client:PoolClient)=>Promise<T>,
):Promise<T> {
  return transact(async client=>{
    const group=await groupLock(client,groupId);
    await memberCheck(client,groupId,actorId);
    if(group.owner_id!==actorId &&
       !(await activeGrant(client,groupId,actorId))) {
      throw new SettlementSettingsError(403,"Bạn không được quản lý quyết toán theo kỳ.");
    }
    return work(client);
  });
}
