import "server-only";
import type { PoolClient } from "pg";

export async function voidExpenseObligations(client: PoolClient, expenseId: string) {
  await client.query(
    "UPDATE obligations SET voided_at = now() WHERE expense_id = $1 AND voided_at IS NULL",
    [expenseId],
  );
}

/**
 * Call within the same transaction that stores the expense and all its item
 * shares. No self-debt is generated; each active obligation retains a
 * permanent list of item-source snapshots even if later revisions replace IDs.
 */
export async function createExpenseObligations(client: PoolClient, expenseId: string, version: number) {
  const obligations = await client.query<{ id: string; debtor_id: string }>(
    `INSERT INTO obligations
       (id, group_id, expense_id, expense_version, debtor_id, creditor_id, amount_minor)
     SELECT gen_random_uuid(), e.group_id, e.id, $2, s.user_id, e.payer_id,
            sum(s.amount_minor)::bigint
     FROM expenses e
     JOIN expense_items i ON i.expense_id = e.id
     JOIN expense_item_shares s ON s.item_id = i.id
     WHERE e.id = $1 AND e.deleted_at IS NULL
       AND s.user_id <> e.payer_id AND s.amount_minor > 0
     GROUP BY e.group_id, e.id, e.payer_id, s.user_id
     RETURNING id, debtor_id`,
    [expenseId, version],
  );
  for (const obligation of obligations.rows) {
    const source = await client.query(
      `INSERT INTO obligation_sources
         (id, obligation_id, expense_item_id, item_name, amount_minor)
       SELECT gen_random_uuid(), $1, i.id, i.name, s.amount_minor
       FROM expense_items i JOIN expense_item_shares s ON s.item_id = i.id
       WHERE i.expense_id = $2 AND s.user_id = $3 AND s.amount_minor > 0`,
      [obligation.id, expenseId, obligation.debtor_id],
    );
    if (!source.rowCount) throw new Error("Missing obligation item sources");
  }
  return obligations.rowCount ?? 0;
}
