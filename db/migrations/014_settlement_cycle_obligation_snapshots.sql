-- SC-004: immutable obligation-eligibility snapshot at REVIEW -> LOCKED.
-- Never modifies balances or settlement allocations; lock is NOT a payment.
-- Preserve SC-003 cycle identity and periods; do not change applied migrations.

ALTER TABLE group_settlement_cycles
 ADD COLUMN locked_at timestamptz,
 ADD COLUMN locked_by text REFERENCES "user"(id) ON DELETE RESTRICT;
ALTER TABLE group_settlement_cycles DROP CONSTRAINT cycle_review_consistent;
ALTER TABLE group_settlement_cycles DROP CONSTRAINT group_settlement_cycles_state_check;
ALTER TABLE group_settlement_cycles ADD CONSTRAINT cycle_state_check
 CHECK (state IN ('open','review','locked'));
ALTER TABLE group_settlement_cycles ADD CONSTRAINT cycle_review_consistent CHECK (
  (state='open' AND reviewed_at IS NULL AND locked_at IS NULL AND locked_by IS NULL)
  OR (state='review' AND reviewed_at IS NOT NULL AND locked_at IS NULL AND locked_by IS NULL)
  OR (state='locked' AND reviewed_at IS NOT NULL
      AND locked_at IS NOT NULL AND locked_by IS NOT NULL AND locked_at >= reviewed_at)
);

CREATE TABLE group_settlement_cycle_snapshot_expenses (
  cycle_id uuid NOT NULL,
  group_id uuid NOT NULL,
  expense_id uuid NOT NULL,
  expense_version integer NOT NULL CHECK(expense_version > 0),
  occurred_on date NOT NULL,
  created_at timestamptz NOT NULL,
  payer_id text NOT NULL,
  created_by text NOT NULL,
  total_minor bigint NOT NULL CHECK(total_minor > 0),
  completed_at timestamptz,
  PRIMARY KEY(cycle_id,expense_id),
  CONSTRAINT snapshot_expense_identity UNIQUE(cycle_id,expense_id,group_id),
  FOREIGN KEY(cycle_id,group_id) REFERENCES group_settlement_cycles(id,group_id) ON DELETE RESTRICT,
  FOREIGN KEY(expense_id,group_id) REFERENCES expenses(id,group_id) ON DELETE RESTRICT
);
CREATE INDEX snapshot_expenses_by_expense
  ON group_settlement_cycle_snapshot_expenses(expense_id,cycle_id);

CREATE TABLE group_settlement_cycle_snapshot_obligations (
  cycle_id uuid NOT NULL,
  group_id uuid NOT NULL,
  obligation_id uuid NOT NULL,
  expense_id uuid NOT NULL,
  expense_version integer NOT NULL CHECK(expense_version>0),
  debtor_id text NOT NULL,
  creditor_id text NOT NULL,
  original_minor bigint NOT NULL CHECK(original_minor > 0),
  confirmed_cash_minor numeric(38,0) NOT NULL DEFAULT 0 CHECK(confirmed_cash_minor>=0),
  pending_cash_minor numeric(38,0) NOT NULL DEFAULT 0 CHECK(pending_cash_minor>=0),
  outstanding_minor numeric(38,0) NOT NULL CHECK(outstanding_minor>=0),
  available_minor numeric(38,0) NOT NULL CHECK(available_minor>=0),
  PRIMARY KEY(cycle_id,obligation_id),
  -- One originating period per obligation. Carry-over is a read projection
  -- and must never create another snapshot source or duplicate debt.
  CONSTRAINT snapshot_one_origin_cycle UNIQUE(obligation_id),
  FOREIGN KEY(cycle_id,expense_id,group_id)
    REFERENCES group_settlement_cycle_snapshot_expenses(cycle_id,expense_id,group_id)
    ON DELETE RESTRICT,
  FOREIGN KEY(obligation_id,group_id,debtor_id,creditor_id)
    REFERENCES obligations(id,group_id,debtor_id,creditor_id) ON DELETE RESTRICT,
  CONSTRAINT snapshot_obligation_money_identity CHECK(
    original_minor=confirmed_cash_minor+outstanding_minor
    AND outstanding_minor=pending_cash_minor+available_minor)
);
CREATE INDEX snapshot_obligations_pair
  ON group_settlement_cycle_snapshot_obligations(cycle_id,debtor_id,creditor_id,obligation_id);

CREATE TABLE group_settlement_cycle_snapshots (
  cycle_id uuid PRIMARY KEY,
  group_id uuid NOT NULL,
  request_key uuid NOT NULL,
  locked_by text NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
  cutoff_at timestamptz NOT NULL,
  sealed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expense_count integer NOT NULL CHECK(expense_count>=0),
  obligation_count integer NOT NULL CHECK(obligation_count>=0),
  original_minor numeric(38,0) NOT NULL CHECK(original_minor>=0),
  confirmed_cash_minor numeric(38,0) NOT NULL CHECK(confirmed_cash_minor>=0),
  pending_cash_minor numeric(38,0) NOT NULL CHECK(pending_cash_minor>=0),
  outstanding_minor numeric(38,0) NOT NULL CHECK(outstanding_minor>=0),
  available_minor numeric(38,0) NOT NULL CHECK(available_minor>=0),
  fingerprint char(64) NOT NULL CHECK(fingerprint ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY(cycle_id,group_id) REFERENCES group_settlement_cycles(id,group_id) ON DELETE RESTRICT,
  CONSTRAINT snapshot_request_unique UNIQUE(group_id,request_key),
  CONSTRAINT snapshot_totals_conserved CHECK(
    original_minor=confirmed_cash_minor+outstanding_minor
    AND outstanding_minor=pending_cash_minor+available_minor)
);

-- Snapshot records are never updated or deleted, including while cycle is
-- disabled. They remain auditable even after later confirmed payments.
CREATE FUNCTION sc004_immutable_snapshot() RETURNS trigger LANGUAGE plpgsql AS $sc004$
BEGIN
  RAISE EXCEPTION 'Financial cycle snapshots are append-only';
END;
$sc004$;
CREATE TRIGGER sc004_expenses_immutable BEFORE UPDATE OR DELETE
 ON group_settlement_cycle_snapshot_expenses FOR EACH ROW
 EXECUTE FUNCTION sc004_immutable_snapshot();
CREATE TRIGGER sc004_obligations_immutable BEFORE UPDATE OR DELETE
 ON group_settlement_cycle_snapshot_obligations FOR EACH ROW
 EXECUTE FUNCTION sc004_immutable_snapshot();
CREATE TRIGGER sc004_manifest_immutable BEFORE UPDATE OR DELETE
 ON group_settlement_cycle_snapshots FOR EACH ROW
 EXECUTE FUNCTION sc004_immutable_snapshot();

-- Lifecycle extension: a valid fully materialized snapshot is REQUIRED to
-- allow REVIEW -> LOCKED. The financial snapshot does not authorize any
-- payment or creator-only invoice completion.
ALTER TABLE group_settlement_cycle_events
 DROP CONSTRAINT group_settlement_cycle_events_event_type_check,
 DROP CONSTRAINT group_settlement_cycle_events_to_state_check,
 DROP CONSTRAINT cycle_event_transition_consistent;
ALTER TABLE group_settlement_cycle_events
 ADD CONSTRAINT cycle_event_type_check
   CHECK(event_type IN ('created','review_requested','snapshot_locked')),
 ADD CONSTRAINT cycle_event_state_check
   CHECK(to_state IN ('open','review','locked')),
 ADD CONSTRAINT cycle_event_transition_consistent CHECK(
   (event_type='created' AND from_state IS NULL AND to_state='open' AND cycle_version=1)
   OR (event_type='review_requested' AND from_state='open' AND to_state='review' AND cycle_version=2)
   OR (event_type='snapshot_locked' AND from_state='review' AND to_state='locked' AND cycle_version=3)
 );

CREATE OR REPLACE FUNCTION sc003_guard_cycle() RETURNS trigger LANGUAGE plpgsql AS $sc004$
DECLARE snapshot_exists boolean;
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'Settlement cycles cannot be deleted';
  END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.state<>'open' OR NEW.version<>1 OR NEW.reviewed_at IS NOT NULL
       OR NEW.locked_at IS NOT NULL OR NEW.locked_by IS NOT NULL THEN
      RAISE EXCEPTION 'Cycle must be created OPEN at version 1';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.state='open' AND NEW.state='review'
     AND OLD.reviewed_at IS NULL AND NEW.reviewed_at IS NOT NULL
     AND NEW.reviewed_at >= OLD.end_at
     AND NEW.version=OLD.version+1
     AND NEW.locked_at IS NULL AND NEW.locked_by IS NULL
     AND (to_jsonb(NEW)-'state'-'version'-'reviewed_at'-'updated_at')
       = (to_jsonb(OLD)-'state'-'version'-'reviewed_at'-'updated_at')
  THEN RETURN NEW;
  END IF;
  IF OLD.state='review' AND NEW.state='locked'
     AND NEW.version=OLD.version+1
     AND OLD.locked_at IS NULL AND OLD.locked_by IS NULL
     AND NEW.locked_at IS NOT NULL AND NEW.locked_by IS NOT NULL
     AND NEW.locked_at >= OLD.reviewed_at
     AND (to_jsonb(NEW)-'state'-'version'-'locked_at'-'locked_by'-'updated_at')
       = (to_jsonb(OLD)-'state'-'version'-'locked_at'-'locked_by'-'updated_at')
  THEN
    SELECT EXISTS (
      SELECT 1 FROM group_settlement_cycle_snapshots s
      WHERE s.cycle_id=NEW.id AND s.group_id=NEW.group_id
        AND s.locked_by=NEW.locked_by AND s.sealed_at <= NEW.locked_at
        AND s.expense_count=(
          SELECT count(*) FROM group_settlement_cycle_snapshot_expenses e
          WHERE e.cycle_id=NEW.id)
        AND s.obligation_count=(
          SELECT count(*) FROM group_settlement_cycle_snapshot_obligations o
          WHERE o.cycle_id=NEW.id)
    ) INTO snapshot_exists;
    IF snapshot_exists THEN RETURN NEW; END IF;
  END IF;
  RAISE EXCEPTION 'Invalid cycle state transition or incomplete financial snapshot';
END;
$sc004$;

-- A frozen source expense cannot change its costs, date, payer or shares.
-- Creator-only completion remains allowed; it is distinct from payment.
CREATE FUNCTION sc004_guard_frozen_expense() RETURNS trigger LANGUAGE plpgsql AS $sc004$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM group_settlement_cycle_snapshot_expenses se
    JOIN group_settlement_cycles c ON c.id=se.cycle_id
    WHERE se.expense_id=OLD.id AND c.state='locked') THEN
    RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'Frozen cycle expense cannot be deleted';
  END IF;
  IF OLD.completed_at IS NULL AND NEW.completed_at IS NOT NULL
    AND NEW.completed_by=OLD.created_by AND NEW.version=OLD.version+1
    AND (to_jsonb(NEW)-'completed_at'-'completed_by'-'version'-'updated_at')
       = (to_jsonb(OLD)-'completed_at'-'completed_by'-'version'-'updated_at')
  THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'Frozen cycle expense can only be creator-completed';
END;
$sc004$;
CREATE TRIGGER sc004_guard_expenses BEFORE UPDATE OR DELETE ON expenses
 FOR EACH ROW EXECUTE FUNCTION sc004_guard_frozen_expense();

CREATE FUNCTION sc004_guard_frozen_items() RETURNS trigger LANGUAGE plpgsql AS $sc004$
DECLARE expense_ref uuid;
BEGIN
  IF TG_TABLE_NAME='expense_items' THEN
    expense_ref=CASE WHEN TG_OP='DELETE' THEN OLD.expense_id ELSE NEW.expense_id END;
  ELSE
    SELECT expense_id INTO expense_ref FROM expense_items
      WHERE id=CASE WHEN TG_OP='DELETE' THEN OLD.item_id ELSE NEW.item_id END;
  END IF;
  IF EXISTS(SELECT 1 FROM group_settlement_cycle_snapshot_expenses se
    JOIN group_settlement_cycles c ON c.id=se.cycle_id
    WHERE se.expense_id=expense_ref AND c.state='locked') THEN
    RAISE EXCEPTION 'Frozen invoice item shares cannot change';
  END IF;
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END;
$sc004$;
CREATE TRIGGER sc004_guard_items BEFORE INSERT OR UPDATE OR DELETE
  ON expense_items FOR EACH ROW EXECUTE FUNCTION sc004_guard_frozen_items();
CREATE TRIGGER sc004_guard_shares BEFORE INSERT OR UPDATE OR DELETE
  ON expense_item_shares FOR EACH ROW EXECUTE FUNCTION sc004_guard_frozen_items();

CREATE FUNCTION sc004_guard_frozen_obligation() RETURNS trigger LANGUAGE plpgsql AS $sc004$
DECLARE oid uuid;
BEGIN
  oid=CASE WHEN TG_OP='INSERT' THEN NEW.id ELSE OLD.id END;
  IF EXISTS (SELECT 1 FROM group_settlement_cycle_snapshot_obligations so
    JOIN group_settlement_cycles c ON c.id=so.cycle_id
    WHERE so.obligation_id=oid AND c.state='locked') THEN
    RAISE EXCEPTION 'Frozen obligation cannot be modified or deleted';
  END IF;
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END;
$sc004$;
CREATE TRIGGER sc004_guard_obligations BEFORE UPDATE OR DELETE
  ON obligations FOR EACH ROW EXECUTE FUNCTION sc004_guard_frozen_obligation();

-- No migration modifies settlements, settlement_allocations, existing debt or
-- the SC-001 financial-engine readiness flag.
