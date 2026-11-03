import "server-only";
import { pool } from "@/lib/db/pool";

export type DebtRow = {
  id: string; groupId: string; groupName: string;
  expenseId: string; expenseTitle: string; expenseVersion: number;
  occurredOn: string; expenseTotalMinor: string; sourceCount: number; sourcePreview: string; debtorId: string; debtorName: string;
  creditorId: string; creditorName: string; amountMinor: string;
  confirmedMinor: string; pendingMinor: string; outstandingMinor: string; availableMinor: string;
};
export type DebtPayment = {
  id: string; status: "pending" | "confirmed" | "rejected" | "cancelled";
  amountMinor: string; initiatedBy: string; resolvedBy: string | null;
  note: string | null; createdAt: string; resolvedAt: string | null;
};
export type DebtSource = {
  itemId: string; itemName: string; amountMinor: string;
};
export type PersonalDebt = {
  direction: "pay" | "receive";
  counterpartyId: string; counterpartyName: string;
  groupId: string; groupName: string; amountMinor: string; pendingMinor: string; availableMinor: string;
  obligationCount: number;
};

function validUUID(input: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input);
}

async function assertGroupMember(groupId: string, userId: string) {
  if (!validUUID(groupId)) return false;
  const gate = await pool.query(
    `SELECT 1 FROM group_members m JOIN groups g ON g.id=m.group_id
     WHERE m.group_id=$1 AND m.user_id=$2 AND m.status='active' AND g.archived_at IS NULL`,
    [groupId, userId],
  );
  return Boolean(gate.rowCount);
}

const debtQuery = `
  SELECT o.id, o.group_id AS "groupId", g.name AS "groupName",
    o.expense_id AS "expenseId", e.title AS "expenseTitle",
    o.expense_version AS "expenseVersion", e.occurred_on::text AS "occurredOn",
    e.total_minor::text AS "expenseTotalMinor",
    (SELECT count(*)::int FROM obligation_sources src WHERE src.obligation_id=o.id) AS "sourceCount",
    COALESCE((SELECT string_agg(src.item_name, ', ' ORDER BY src.item_name)
      FROM obligation_sources src WHERE src.obligation_id=o.id),'') AS "sourcePreview",
    o.debtor_id AS "debtorId", debtor.name AS "debtorName",
    o.creditor_id AS "creditorId", creditor.name AS "creditorName",
    o.amount_minor::text AS "amountMinor",
    COALESCE((SELECT sum(a.amount_minor) FROM settlement_allocations a
      JOIN settlements st ON st.id=a.settlement_id
      WHERE a.obligation_id=o.id AND st.status='confirmed'),0)::text AS "confirmedMinor",
    COALESCE((SELECT sum(a.amount_minor) FROM settlement_allocations a
      JOIN settlements st ON st.id=a.settlement_id
      WHERE a.obligation_id=o.id AND st.status='pending'),0)::text AS "pendingMinor",
    (o.amount_minor-COALESCE((SELECT sum(a.amount_minor) FROM settlement_allocations a
      JOIN settlements st ON st.id=a.settlement_id
      WHERE a.obligation_id=o.id AND st.status='confirmed'),0))::text AS "outstandingMinor",
    (o.amount_minor-COALESCE((SELECT sum(a.amount_minor) FROM settlement_allocations a
      JOIN settlements st ON st.id=a.settlement_id
      WHERE a.obligation_id=o.id AND st.status IN ('confirmed','pending')),0))::text AS "availableMinor"
  FROM obligations o
  JOIN expenses e ON e.id=o.expense_id AND e.deleted_at IS NULL
  JOIN groups g ON g.id=o.group_id AND g.archived_at IS NULL
  JOIN "user" debtor ON debtor.id=o.debtor_id
  JOIN "user" creditor ON creditor.id=o.creditor_id
  WHERE o.voided_at IS NULL
`;

export async function listGroupDebts(groupId: string, actorId: string): Promise<DebtRow[] | null> {
  if (!(await assertGroupMember(groupId, actorId))) return null;
  const result = await pool.query<DebtRow>(
    debtQuery + ` AND o.group_id=$1
      ORDER BY e.occurred_on DESC, e.created_at DESC, o.debtor_id, o.id LIMIT 500`,
    [groupId],
  );
  return result.rows;
}

export async function listExpenseDebts(groupId: string, expenseId: string, actorId: string) {
  if (!(await assertGroupMember(groupId, actorId))) return null;
  if (!validUUID(expenseId)) return [];
  const result = await pool.query<DebtRow>(
    debtQuery + " AND o.group_id=$1 AND o.expense_id=$2 ORDER BY debtor.name",
    [groupId, expenseId],
  );
  return result.rows;
}

export async function getDebtDetails(groupId: string, debtId: string, actorId: string):
  Promise<{ debt: DebtRow; sources: DebtSource[]; payments: DebtPayment[] } | null> {
  if (!(await assertGroupMember(groupId, actorId)) || !validUUID(debtId)) return null;
  const result = await pool.query<DebtRow>(
    debtQuery + " AND o.group_id=$1 AND o.id=$2", [groupId, debtId],
  );
  const debt = result.rows[0];
  if (!debt) return null;
  const sources = await pool.query<DebtSource>(
    `SELECT expense_item_id AS "itemId", item_name AS "itemName",
            amount_minor::text AS "amountMinor"
     FROM obligation_sources WHERE obligation_id=$1 ORDER BY item_name, id`, [debtId],
  );
  const payments = await pool.query<DebtPayment>(
    `SELECT s.id, s.status, a.amount_minor::text AS "amountMinor",
            s.initiated_by AS "initiatedBy", s.resolved_by AS "resolvedBy",
            s.note, s.created_at::text AS "createdAt",
            s.resolved_at::text AS "resolvedAt"
     FROM settlement_allocations a
     JOIN settlements s ON s.id=a.settlement_id
     WHERE a.obligation_id=$1 AND s.group_id=$2
     ORDER BY s.created_at DESC, s.id DESC LIMIT 100`,
    [debtId, groupId],
  );
  return { debt, sources: sources.rows, payments: payments.rows };
}

export async function listPersonalDebts(userId: string): Promise<PersonalDebt[]> {
  const result = await pool.query<PersonalDebt>(
    `WITH live AS (
       SELECT o.*,
         COALESCE((SELECT sum(a.amount_minor) FROM settlement_allocations a
           JOIN settlements st ON st.id=a.settlement_id
           WHERE a.obligation_id=o.id AND st.status='confirmed'),0) AS confirmed,
         COALESCE((SELECT sum(a.amount_minor) FROM settlement_allocations a
           JOIN settlements st ON st.id=a.settlement_id
           WHERE a.obligation_id=o.id AND st.status='pending'),0) AS pending
       FROM obligations o
       JOIN expenses e ON e.id=o.expense_id AND e.deleted_at IS NULL
       JOIN groups g ON g.id=o.group_id AND g.archived_at IS NULL
       JOIN group_members m ON m.group_id=o.group_id AND m.user_id=$1 AND m.status='active'
       WHERE o.voided_at IS NULL AND (o.debtor_id=$1 OR o.creditor_id=$1)
     )
     SELECT CASE WHEN o.debtor_id=$1 THEN 'pay' ELSE 'receive' END AS direction,
       CASE WHEN o.debtor_id=$1 THEN o.creditor_id ELSE o.debtor_id END AS "counterpartyId",
       u.name AS "counterpartyName",o.group_id AS "groupId",g.name AS "groupName",
       sum(o.amount_minor-o.confirmed)::text AS "amountMinor",
       sum(o.pending)::text AS "pendingMinor",
       sum(o.amount_minor-o.confirmed-o.pending)::text AS "availableMinor",
       count(*)::int AS "obligationCount"
     FROM live o JOIN groups g ON g.id=o.group_id
     JOIN "user" u ON u.id=CASE WHEN o.debtor_id=$1 THEN o.creditor_id ELSE o.debtor_id END
     GROUP BY direction,"counterpartyId",u.name,o.group_id,g.name
     HAVING sum(o.amount_minor-o.confirmed)>0
     ORDER BY g.name,u.name,direction`, [userId]
  );
  return result.rows;
}

/** Each card maps to one source-traceable obligation, not a collapsed net balance. */
export async function listPersonalDebtItems(userId: string): Promise<DebtRow[]> {
  const result = await pool.query<DebtRow>(
    debtQuery + ` AND (o.debtor_id=$1 OR o.creditor_id=$1)
      AND EXISTS (SELECT 1 FROM group_members m
        WHERE m.group_id=o.group_id AND m.user_id=$1 AND m.status='active')
      AND o.amount_minor > COALESCE((SELECT sum(a.amount_minor)
        FROM settlement_allocations a JOIN settlements st ON st.id=a.settlement_id
        WHERE a.obligation_id=o.id AND st.status='confirmed'),0)
      ORDER BY e.occurred_on DESC, e.created_at DESC, o.id DESC LIMIT 250`,
    [userId],
  );
  return result.rows;
}

export function sumDebtAmounts(rows: readonly { amountMinor: string }[]): string {
  return rows.reduce((sum, row) => sum + BigInt(row.amountMinor), 0n).toString();
}
