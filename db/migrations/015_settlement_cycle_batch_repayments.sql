-- SC-005: Link ONE pending, ordinary bilateral cash settlement to ONE
-- immutable locked cycle's source obligations. This creates no new ledger,
-- balances, noncash set-offs or financial state transitions.
ALTER TABLE group_settlement_cycle_snapshots
  ADD CONSTRAINT cycle_snapshot_group_identity UNIQUE(cycle_id,group_id);

CREATE TABLE group_settlement_cycle_repayments (
  settlement_id uuid PRIMARY KEY,
  group_id uuid NOT NULL,
  cycle_id uuid NOT NULL,
  debtor_id text NOT NULL,
  creditor_id text NOT NULL,
  initiated_by text NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
  preview_fingerprint char(64) NOT NULL CHECK(preview_fingerprint ~ '^[0-9a-f]{64}$'),
  allocation_count integer NOT NULL CHECK(allocation_count>0),
  amount_minor bigint NOT NULL CHECK(amount_minor>0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT cycle_repayment_no_self CHECK(debtor_id<>creditor_id),
  CONSTRAINT cycle_repayment_counterparty CHECK(initiated_by IN (debtor_id,creditor_id)),
  CONSTRAINT cycle_repayment_cycle_fk
    FOREIGN KEY(cycle_id,group_id)
    REFERENCES group_settlement_cycle_snapshots(cycle_id,group_id) ON DELETE RESTRICT,
  CONSTRAINT cycle_repayment_original_cash_fk
    FOREIGN KEY(settlement_id,group_id,debtor_id,creditor_id)
    REFERENCES settlements(id,group_id,debtor_id,creditor_id) ON DELETE RESTRICT
);
CREATE INDEX cycle_repayments_pair_idx
  ON group_settlement_cycle_repayments(cycle_id,debtor_id,creditor_id,created_at DESC);

-- SQL bypass cannot associate an ordinary settlement with a made-up cycle,
-- wrong counterparty, another group's obligations or a fabricated sum.
CREATE FUNCTION sc005_guard_batch_create() RETURNS trigger LANGUAGE plpgsql AS $sc005$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM settlements st
    JOIN group_settlement_cycles c ON c.id=NEW.cycle_id AND c.group_id=NEW.group_id
    JOIN group_settlement_settings cfg ON cfg.group_id=c.group_id
    WHERE st.id=NEW.settlement_id
      AND st.group_id=NEW.group_id
      AND st.debtor_id=NEW.debtor_id AND st.creditor_id=NEW.creditor_id
      AND st.initiated_by=NEW.initiated_by
      AND st.status='pending'
      AND cfg.requested_enabled=true
      AND c.state='locked'
      AND st.amount_minor=NEW.amount_minor
      AND st.amount_minor=(
        SELECT COALESCE(sum(a.amount_minor),0)
        FROM settlement_allocations a WHERE a.settlement_id=NEW.settlement_id)
      AND NEW.allocation_count=(
        SELECT count(*) FROM settlement_allocations a
        WHERE a.settlement_id=NEW.settlement_id)
      AND NOT EXISTS (
        SELECT 1 FROM settlement_allocations a
        LEFT JOIN group_settlement_cycle_snapshot_obligations src
          ON src.cycle_id=NEW.cycle_id AND src.obligation_id=a.obligation_id
          AND src.group_id=NEW.group_id AND src.debtor_id=NEW.debtor_id
          AND src.creditor_id=NEW.creditor_id
        LEFT JOIN obligations o ON o.id=a.obligation_id
        LEFT JOIN expenses e ON e.id=o.expense_id
        WHERE a.settlement_id=NEW.settlement_id
          AND (src.obligation_id IS NULL OR o.voided_at IS NOT NULL
            OR e.deleted_at IS NOT NULL
            OR o.amount_minor<>src.original_minor
            OR o.expense_version<>src.expense_version)
      )
  ) THEN
    RAISE EXCEPTION 'SC-005 repayment cannot bind invalid or incomplete allocations';
  END IF;
  RETURN NEW;
END;
$sc005$;
CREATE TRIGGER sc005_repayment_insert_validate
  BEFORE INSERT ON group_settlement_cycle_repayments
  FOR EACH ROW EXECUTE FUNCTION sc005_guard_batch_create();

CREATE FUNCTION sc005_repayment_immutable() RETURNS trigger LANGUAGE plpgsql AS $sc005$
BEGIN
  RAISE EXCEPTION 'SC-005 repayment provenance is append-only';
END;
$sc005$;
CREATE TRIGGER sc005_repayment_history_guard
  BEFORE UPDATE OR DELETE ON group_settlement_cycle_repayments
  FOR EACH ROW EXECUTE FUNCTION sc005_repayment_immutable();

-- Original settlements, allocations and approval events remain canonical.
-- Both parties must still confirm via the existing cash-settlement API.
