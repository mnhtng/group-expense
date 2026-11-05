import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";

test("SQL migrations are installed and group foreign keys protect integrity", async () => {
  if (!process.env.DATABASE_URL) return;
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const tables = await pool.query("SELECT filename FROM schema_migrations ORDER BY filename");
    assert.deepEqual(tables.rows.map((r) => r.filename), ["001_auth.sql", "002_groups.sql", "003_expenses.sql", "004_obligation_ledger.sql", "005_settlements.sql", "006_notifications.sql", "007_group_membership_lifecycle.sql", "008_optional_notes.sql", "009_expense_completion.sql", "010_monthly_recurring_expenses.sql", "011_settlement_cycle_feature_gates.sql", "012_settlement_cycle_schedule.sql", "013_settlement_cycle_lifecycle.sql", "014_settlement_cycle_obligation_snapshots.sql", "015_settlement_cycle_batch_repayments.sql", "016_bilateral_proposal_documents.sql", "017_bilateral_decision_events.sql", "018_bilateral_noncash_applications.sql", "019_bilateral_setoff_balance_integration.sql", "020_bilateral_residual_cash_repayments.sql", "021_settlement_cycle_late_adjustments.sql", "022_settlement_cycle_notifications_disputes.sql"]);
    await assert.rejects(
      pool.query("INSERT INTO groups(id, owner_id, name) VALUES($1,$2,$3)",
        [randomUUID(), "nonexistent-user-id", "Test group"]),
      (error) => error.code === "23503",
    );
  } finally {
    await pool.end();
  }
});
