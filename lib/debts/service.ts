import "server-only";
import { pool } from "@/lib/db/pool";

export type DebtRow = {
  id: string; groupId: string; groupName: string;
  expenseId: string; expenseTitle: string; expenseVersion: number;
  occurredOn: string; expenseTotalMinor: string; sourceCount: number; sourcePreview: string; debtorId: string; debtorName: string;
  creditorId: string; creditorName: string; amountMinor: string;
  confirmedMinor: string; confirmedCashMinor: string; confirmedSetoffMinor: string;
  pendingMinor: string; outstandingMinor: string; availableMinor: string;
};
export type DebtPayment = {
  id: string; status: "pending" | "confirmed" | "rejected" | "cancelled";
  amountMinor: string; initiatedBy: string; resolvedBy: string | null;
  note: string | null; createdAt: string; resolvedAt: string | null;
};
export type DebtSetoff = {
  applicationId: string; proposalId: string; cycleId: string;
  amountMinor: string; appliedBy: string; appliedAt: string;
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
    (bal.confirmed_cash_minor+bal.confirmed_setoff_minor)::text AS "confirmedMinor",
    bal.confirmed_cash_minor::text AS "confirmedCashMinor",
    bal.confirmed_setoff_minor::text AS "confirmedSetoffMinor",
    bal.pending_cash_minor::text AS "pendingMinor",
    bal.outstanding_minor::text AS "outstandingMinor",
    bal.available_minor::text AS "availableMinor"
  FROM obligations o
  JOIN bn005_obligation_balances bal ON bal.obligation_id=o.id
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

/** Canonical full-group rollup (NO 500-row UI list cap).
 * All entries come from original nonvoid obligations; applied set-off
 * changes outstanding/available but never duplicates expense totals.
 */
export async function getGroupDebtTotals(groupId:string,actorId:string):
  Promise<{outstandingMinor:string;myPayableMinor:string;myReceivableMinor:string}|null>{
  if(!(await assertGroupMember(groupId,actorId)))return null;
  const r=await pool.query<{
    outstandingMinor:string;myPayableMinor:string;myReceivableMinor:string;
  }>(`SELECT
     COALESCE(sum(b.outstanding_minor),0)::text AS "outstandingMinor",
     COALESCE(sum(b.outstanding_minor) FILTER(WHERE o.debtor_id=$2),0)::text
       AS "myPayableMinor",
     COALESCE(sum(b.outstanding_minor) FILTER(WHERE o.creditor_id=$2),0)::text
       AS "myReceivableMinor"
   FROM obligations o
   JOIN bn005_obligation_balances b ON b.obligation_id=o.id
   JOIN expenses e ON e.id=o.expense_id AND e.deleted_at IS NULL
   WHERE o.group_id=$1 AND o.voided_at IS NULL`,[groupId,actorId]);
  return r.rows[0]??{outstandingMinor:"0",myPayableMinor:"0",myReceivableMinor:"0"};
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
  Promise<{ debt: DebtRow; sources: DebtSource[]; payments: DebtPayment[]; setoffs: DebtSetoff[] } | null> {
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
  const setoffs=await pool.query<DebtSetoff>(
    `SELECT a.application_id AS "applicationId",a.proposal_id AS "proposalId",
       a.cycle_id AS "cycleId",a.amount_minor::text AS "amountMinor",
       app.applied_by AS "appliedBy",app.created_at::text AS "appliedAt"
     FROM group_settlement_bilateral_application_allocations a
     JOIN group_settlement_bilateral_applications app ON app.id=a.application_id
     WHERE a.group_id=$1 AND a.obligation_id=$2
     ORDER BY app.created_at DESC,app.id DESC`,[groupId,debtId],
  );
  return { debt, sources: sources.rows, payments: payments.rows, setoffs: setoffs.rows };
}

export async function listPersonalDebts(userId: string): Promise<PersonalDebt[]> {
  const result = await pool.query<PersonalDebt>(
    `WITH live AS (
       SELECT o.*,bal.outstanding_minor AS remaining,
         bal.pending_cash_minor AS pending,
         bal.available_minor AS available
       FROM obligations o
       JOIN bn005_obligation_balances bal ON bal.obligation_id=o.id
       JOIN expenses e ON e.id=o.expense_id AND e.deleted_at IS NULL
       JOIN groups g ON g.id=o.group_id AND g.archived_at IS NULL
       JOIN group_members m ON m.group_id=o.group_id AND m.user_id=$1 AND m.status='active'
       WHERE o.voided_at IS NULL AND (o.debtor_id=$1 OR o.creditor_id=$1)
     )
     SELECT CASE WHEN o.debtor_id=$1 THEN 'pay' ELSE 'receive' END AS direction,
       CASE WHEN o.debtor_id=$1 THEN o.creditor_id ELSE o.debtor_id END AS "counterpartyId",
       u.name AS "counterpartyName",o.group_id AS "groupId",g.name AS "groupName",
       sum(o.remaining)::text AS "amountMinor",
       sum(o.pending)::text AS "pendingMinor",
       sum(o.available)::text AS "availableMinor",
       count(*)::int AS "obligationCount"
     FROM live o JOIN groups g ON g.id=o.group_id
     JOIN "user" u ON u.id=CASE WHEN o.debtor_id=$1 THEN o.creditor_id ELSE o.debtor_id END
     GROUP BY direction,"counterpartyId",u.name,o.group_id,g.name
     HAVING sum(o.remaining)>0
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
      AND bal.outstanding_minor > 0
      ORDER BY e.occurred_on DESC, e.created_at DESC, o.id DESC LIMIT 250`,
    [userId],
  );
  return result.rows;
}

export function sumDebtAmounts(rows: readonly { amountMinor: string }[]): string {
  return rows.reduce((sum, row) => sum + BigInt(row.amountMinor), 0n).toString();
}
