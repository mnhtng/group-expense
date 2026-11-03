import "server-only";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { pool } from "@/lib/db/pool";
import { createExpenseObligations, voidExpenseObligations } from "@/lib/debts/ledger";
import { prepareExpense, type ExpenseInput, type PreparedExpense } from "@/lib/expenses/domain";

export class ExpenseAccessError extends Error {
  constructor(public readonly status: 403 | 404 | 409, message: string) {
    super(message);
    this.name = "ExpenseAccessError";
  }
}

type ExpenseSummary = {
  id: string; title: string; totalMinor: string; occurredOn: string;
  payerId: string; payerName: string; version: number; itemCount: number;
};
type ExpenseItem = {
  id: string; name: string; quantity: number; unitPriceMinor: string;
  amountMinor: string; shares: { userId: string; userName: string; amountMinor: string }[];
};
export type ExpenseDetail = ExpenseSummary & {
  groupId: string; notes: string; createdBy: string;
  items: ExpenseItem[];
};

async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function lockGroupMembers(client: PoolClient, groupId: string, actorId: string) {
  // Serialize with group archival / membership mutations using the group row lock.
  const group = await client.query(
    "SELECT id FROM groups WHERE id = $1 AND archived_at IS NULL FOR UPDATE",
    [groupId],
  );
  if (!group.rowCount) throw new ExpenseAccessError(404, "Không tìm thấy nhóm.");
  const members = await client.query<{ user_id: string; role: string }>(
    "SELECT user_id, role FROM group_members WHERE group_id = $1 AND status='active'",
    [groupId],
  );
  const role = members.rows.find(m => m.user_id === actorId)?.role;
  if (!role) throw new ExpenseAccessError(404, "Không tìm thấy nhóm.");
  return { members: members.rows.map(m => m.user_id), role };
}

function editable(role: string, creator: string, actor: string): boolean {
  return creator === actor || role === "owner" || role === "admin";
}


async function assertNoActiveSettlements(client: PoolClient, expenseId: string) {
  const current=await client.query(
    `SELECT 1 FROM obligations o JOIN settlement_allocations a ON a.obligation_id=o.id
     JOIN settlements s ON s.id=a.settlement_id
     WHERE o.expense_id=$1 AND s.status IN ('pending','confirmed') LIMIT 1`,
    [expenseId],
  );
  if(current.rowCount) throw new ExpenseAccessError(409,
    "Hóa đơn có thanh toán đang chờ hoặc đã xác nhận; cần điều chỉnh bằng nghiệp vụ riêng.");
}

async function writeItems(client: PoolClient, groupId: string, expenseId: string, prepared: PreparedExpense) {
  for (const [position, item] of prepared.items.entries()) {
    const itemId = randomUUID();
    await client.query(
      `INSERT INTO expense_items
       (id, expense_id, group_id, position, name, quantity, unit_price_minor, amount_minor)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [itemId, expenseId, groupId, position, item.name, item.quantity, item.unitPriceMinor, item.amountMinor],
    );
    for (const share of item.shares) {
      await client.query(
        `INSERT INTO expense_item_shares(item_id, group_id, user_id, amount_minor)
         VALUES ($1,$2,$3,$4)`,
        [itemId, groupId, share.userId, share.amountMinor],
      );
    }
  }
}

async function recordEvent(client: PoolClient, groupId: string, expenseId: string,
  actorId: string, operation: "created" | "updated" | "deleted", version: number, snapshot: unknown) {
  await client.query(
    `INSERT INTO expense_events
     (id, group_id, expense_id, actor_id, operation, version, snapshot)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
    [randomUUID(), groupId, expenseId, actorId, operation, version, JSON.stringify(snapshot)],
  );
}

export async function createExpense(groupId: string, actorId: string, data: ExpenseInput) {
  return withTransaction(async client => {
    const { members } = await lockGroupMembers(client, groupId, actorId);
    const prepared = prepareExpense(data, members);
    const id = randomUUID();
    await client.query(
      `INSERT INTO expenses
       (id, group_id, payer_id, created_by, title, notes, occurred_on, total_minor)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [id, groupId, prepared.payerId, actorId, prepared.title,
        prepared.notes, prepared.occurredOn, prepared.totalMinor],
    );
    await writeItems(client, groupId, id, prepared);
    await createExpenseObligations(client, id, 1);
    await recordEvent(client, groupId, id, actorId, "created", 1, prepared);
    return { id, version: 1 };
  });
}

export async function updateExpense(groupId: string, expenseId: string, actorId: string,
  expectedVersion: number, data: ExpenseInput) {
  return withTransaction(async client => {
    const { members, role } = await lockGroupMembers(client, groupId, actorId);
    const current = await client.query<{ version: number; created_by: string }>(
      `SELECT version, created_by FROM expenses
       WHERE id = $1 AND group_id = $2 AND deleted_at IS NULL FOR UPDATE`,
      [expenseId, groupId],
    );
    const expense = current.rows[0];
    if (!expense) throw new ExpenseAccessError(404, "Không tìm thấy hóa đơn.");
    if (!editable(role, expense.created_by, actorId)) {
      throw new ExpenseAccessError(403, "Bạn không có quyền sửa hóa đơn.");
    }
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion !== expense.version) {
      throw new ExpenseAccessError(409, "Hóa đơn đã được cập nhật; tải lại trước khi sửa.");
    }
    await assertNoActiveSettlements(client, expenseId);
    const prepared = prepareExpense(data, members);
    const version = expense.version + 1;
    await client.query(
      `UPDATE expenses SET payer_id=$3, title=$4, notes=$5, occurred_on=$6,
       total_minor=$7, version=$8, updated_at=now()
       WHERE id=$1 AND group_id=$2`,
      [expenseId, groupId, prepared.payerId, prepared.title, prepared.notes,
        prepared.occurredOn, prepared.totalMinor, version],
    );
    // Preserve immutable obligation/source history before replacing mutable item IDs.
    await voidExpenseObligations(client, expenseId);
    await client.query("DELETE FROM expense_items WHERE expense_id=$1 AND group_id=$2", [expenseId, groupId]);
    await writeItems(client, groupId, expenseId, prepared);
    await createExpenseObligations(client, expenseId, version);
    await recordEvent(client, groupId, expenseId, actorId, "updated", version, prepared);
    return { id: expenseId, version };
  });
}

export async function deleteExpense(groupId: string, expenseId: string, actorId: string, expectedVersion: number) {
  return withTransaction(async client => {
    const { role } = await lockGroupMembers(client, groupId, actorId);
    const current = await client.query<{ version: number; created_by: string }>(
      `SELECT version, created_by FROM expenses
       WHERE id=$1 AND group_id=$2 AND deleted_at IS NULL FOR UPDATE`,
      [expenseId, groupId],
    );
    const expense = current.rows[0];
    if (!expense) throw new ExpenseAccessError(404, "Không tìm thấy hóa đơn.");
    if (!editable(role, expense.created_by, actorId)) {
      throw new ExpenseAccessError(403, "Bạn không có quyền xóa hóa đơn.");
    }
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion !== expense.version) {
      throw new ExpenseAccessError(409, "Hóa đơn đã thay đổi; tải lại trước khi xóa.");
    }
    await assertNoActiveSettlements(client, expenseId);
    const version = expense.version + 1;
    await client.query(
      "UPDATE expenses SET deleted_at=now(), updated_at=now(), version=$3 WHERE id=$1 AND group_id=$2",
      [expenseId, groupId, version],
    );
    await voidExpenseObligations(client, expenseId);
    await recordEvent(client, groupId, expenseId, actorId, "deleted", version, { previousVersion: expense.version });
    return { id: expenseId, version };
  });
}

const groupMemberGate = `EXISTS(
  SELECT 1 FROM group_members gm JOIN groups gg ON gg.id=gm.group_id
  WHERE gm.group_id=e.group_id AND gm.user_id=$2 AND gm.status='active' AND gg.archived_at IS NULL
)`;

export async function listExpenses(groupId: string, actorId: string): Promise<ExpenseSummary[]> {
  const gate = await pool.query(
    `SELECT 1 FROM group_members m JOIN groups g ON g.id=m.group_id
     WHERE m.group_id=$1 AND m.user_id=$2 AND m.status='active' AND g.archived_at IS NULL`,
    [groupId, actorId],
  );
  if (!gate.rowCount) throw new ExpenseAccessError(404, "Không tìm thấy nhóm.");
  const result = await pool.query<ExpenseSummary>(
    `SELECT e.id, e.title, e.total_minor::text AS "totalMinor",
      e.occurred_on::text AS "occurredOn", e.payer_id AS "payerId",
      u.name AS "payerName", e.version,
      (SELECT count(*)::int FROM expense_items i WHERE i.expense_id=e.id) AS "itemCount"
     FROM expenses e JOIN "user" u ON u.id=e.payer_id
     WHERE e.group_id=$1 AND e.deleted_at IS NULL AND ${groupMemberGate}
     ORDER BY e.occurred_on DESC, e.created_at DESC LIMIT 100`,
    [groupId, actorId],
  );
  return result.rows;
}

export async function getExpense(groupId: string, expenseId: string, actorId: string): Promise<ExpenseDetail | null> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const head = await client.query<ExpenseDetail>(
      `SELECT e.id, e.group_id AS "groupId", e.title, coalesce(e.notes,'') AS notes,
       e.total_minor::text AS "totalMinor", e.occurred_on::text AS "occurredOn",
       e.payer_id AS "payerId", u.name AS "payerName", e.created_by AS "createdBy",
       e.version, (SELECT count(*)::int FROM expense_items WHERE expense_id=e.id) AS "itemCount"
       FROM expenses e JOIN "user" u ON u.id=e.payer_id
       WHERE e.group_id=$1 AND e.id=$3 AND e.deleted_at IS NULL AND ${groupMemberGate}`,
      [groupId, actorId, expenseId],
    );
    const detail = head.rows[0];
    if (!detail) { await client.query("COMMIT"); return null; }
    const items = await client.query<Omit<ExpenseItem,"shares">>(
      `SELECT id, name, quantity, unit_price_minor::text AS "unitPriceMinor",
       amount_minor::text AS "amountMinor" FROM expense_items
       WHERE expense_id=$1 ORDER BY position`,
      [expenseId],
    );
    const shares = await client.query<{ itemId: string; userId: string; userName: string; amountMinor: string }>(
      `SELECT s.item_id AS "itemId", s.user_id AS "userId", u.name AS "userName",
       s.amount_minor::text AS "amountMinor"
       FROM expense_item_shares s JOIN expense_items i ON i.id=s.item_id
       JOIN "user" u ON u.id=s.user_id WHERE i.expense_id=$1 ORDER BY s.user_id`,
      [expenseId],
    );
    const grouped = new Map<string, ExpenseItem["shares"]>();
    for (const share of shares.rows) {
      const current = grouped.get(share.itemId) ?? [];
      current.push({ userId: share.userId, userName: share.userName, amountMinor: share.amountMinor });
      grouped.set(share.itemId, current);
    }
    detail.items = items.rows.map(item => ({ ...item, shares: grouped.get(item.id) ?? [] }));
    await client.query("COMMIT");
    return detail;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
