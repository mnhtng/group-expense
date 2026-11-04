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

-- Once a batch provenance record exists, an allocation is immutable.
-- A later confirmation changes ONLY settlement status; it may never move
-- allocations to another cycle, add rows or silently increase cash.
CREATE FUNCTION sc005_guard_allocation() RETURNS trigger LANGUAGE plpgsql AS $sc005$
DECLARE old_id uuid; new_id uuid;
BEGIN
  IF TG_OP<>'INSERT' THEN old_id=OLD.settlement_id; END IF;
  IF TG_OP<>'DELETE' THEN new_id=NEW.settlement_id; END IF;
  IF EXISTS (
    SELECT 1 FROM group_settlement_cycle_repayments r
    WHERE r.settlement_id=ANY(ARRAY[old_id,new_id])
  ) THEN
    RAISE EXCEPTION 'SC-005 batch allocations are immutable';
  END IF;
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END;
$sc005$;
CREATE TRIGGER sc005_allocations_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON settlement_allocations
  FOR EACH ROW EXECUTE FUNCTION sc005_guard_allocation();

-- SC-005 inherits existing two-party confirmation. Protect the original
-- amount, pair, actor and idempotency fingerprint even from SQL bypasses.
CREATE FUNCTION sc005_guard_settlement() RETURNS trigger LANGUAGE plpgsql AS $sc005$
DECLARE is_batch boolean;
BEGIN
  SELECT EXISTS(SELECT 1 FROM group_settlement_cycle_repayments
    WHERE settlement_id=OLD.id) INTO is_batch;
  IF NOT is_batch THEN
    RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF TG_OP='UPDATE' AND OLD.status='pending'
     AND NEW.status IN ('confirmed','rejected','cancelled')
     AND NEW.resolved_at IS NOT NULL
     AND NEW.resolved_at>=OLD.created_at
     AND (
       (NEW.status='cancelled' AND NEW.resolved_by=OLD.initiated_by)
       OR (NEW.status IN ('confirmed','rejected') AND
           NEW.resolved_by IN (OLD.debtor_id,OLD.creditor_id) AND
           NEW.resolved_by<>OLD.initiated_by)
     )
     AND (to_jsonb(NEW)-'status'-'resolved_at'-'resolved_by')
       = (to_jsonb(OLD)-'status'-'resolved_at'-'resolved_by')
  THEN RETURN NEW;
  END IF;
  RAISE EXCEPTION 'SC-005 batch payment cannot be altered outside two-party transition';
END;
$sc005$;
CREATE TRIGGER sc005_settlement_transition_guard
  BEFORE UPDATE OR DELETE ON settlements
  FOR EACH ROW EXECUTE FUNCTION sc005_guard_settlement();

CREATE FUNCTION sc005_guard_settlement_event() RETURNS trigger LANGUAGE plpgsql AS $sc005$
BEGIN
  IF EXISTS(SELECT 1 FROM group_settlement_cycle_repayments r
            WHERE r.settlement_id=OLD.settlement_id) THEN
    RAISE EXCEPTION 'SC-005 settlement events are append-only';
  END IF;
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END;
$sc005$;
CREATE TRIGGER sc005_batch_events_immutable
  BEFORE UPDATE OR DELETE ON settlement_events
  FOR EACH ROW EXECUTE FUNCTION sc005_guard_settlement_event();

-- Original settlements, allocations and approval events remain canonical.
-- Both parties must still confirm via the existing cash-settlement API.
