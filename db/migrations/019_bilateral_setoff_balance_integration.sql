-- BN-005: derive confirmed noncash set-off solely from successfully applied
-- BN-004 original-obligation allocations. Never transform it into cash.
-- One source of truth for every monetary read and new cash reservation.
CREATE VIEW bn005_obligation_balances AS
SELECT o.id AS obligation_id, o.group_id,
  o.amount_minor::numeric AS original_minor,
  COALESCE(cash.confirmed_cash,0::numeric) AS confirmed_cash_minor,
  COALESCE(cash.pending_cash,0::numeric) AS pending_cash_minor,
  COALESCE(noncash.confirmed_setoff,0::numeric) AS confirmed_setoff_minor,
  0::numeric AS pending_setoff_minor,
  (o.amount_minor::numeric
    - COALESCE(cash.confirmed_cash,0::numeric)
    - COALESCE(noncash.confirmed_setoff,0::numeric)) AS outstanding_minor,
  (o.amount_minor::numeric
    - COALESCE(cash.confirmed_cash,0::numeric)
    - COALESCE(noncash.confirmed_setoff,0::numeric)
    - COALESCE(cash.pending_cash,0::numeric)) AS available_minor
FROM obligations o
LEFT JOIN LATERAL (
  SELECT COALESCE(sum(sa.amount_minor) FILTER
    (WHERE s.status='confirmed'),0::numeric) AS confirmed_cash,
    COALESCE(sum(sa.amount_minor) FILTER
    (WHERE s.status='pending'),0::numeric) AS pending_cash
  FROM settlement_allocations sa
  JOIN settlements s ON s.id=sa.settlement_id
    AND s.group_id=o.group_id
  WHERE sa.obligation_id=o.id AND sa.group_id=o.group_id
) cash ON TRUE
LEFT JOIN LATERAL (
  SELECT COALESCE(sum(a.amount_minor),0::numeric) AS confirmed_setoff
  FROM group_settlement_bilateral_application_allocations a
  JOIN group_settlement_bilateral_applications app
    ON app.id=a.application_id AND app.group_id=o.group_id
  WHERE a.obligation_id=o.id AND a.group_id=o.group_id
) noncash ON TRUE;

COMMENT ON VIEW bn005_obligation_balances IS
 'BN-005 canonical original - confirmed cash - applied noncash; pending cash reserves availability but never extinguishes debt. No pending noncash reservations exist in BN-004.';

-- Ordinary cash SQL writers must not overbook an already applied noncash
-- discharge. A deferred check handles multi-row cash inserts and checks
-- the final committed balance (including any pending cash).
CREATE FUNCTION bn005_assert_cash_capacity() RETURNS trigger LANGUAGE plpgsql AS $bn005$
DECLARE oid uuid; balance record;
BEGIN
  IF TG_TABLE_NAME='settlement_allocations' THEN
    oid:=COALESCE(NEW.obligation_id,OLD.obligation_id);
    IF TG_OP='DELETE' THEN oid:=OLD.obligation_id; END IF;
    IF TG_OP='UPDATE' THEN
      PERFORM 1 FROM obligations WHERE id=OLD.obligation_id FOR UPDATE;
      SELECT original_minor,confirmed_cash_minor,pending_cash_minor,
        confirmed_setoff_minor,outstanding_minor,available_minor
      INTO balance FROM bn005_obligation_balances WHERE obligation_id=OLD.obligation_id;
      IF balance.original_minor IS NULL OR balance.outstanding_minor<0 OR
         balance.available_minor<0 THEN
        RAISE EXCEPTION 'BN-005 cash exceeds live debt after noncash application';
      END IF;
    END IF;
    PERFORM 1 FROM obligations WHERE id=oid FOR UPDATE;
    SELECT original_minor,confirmed_cash_minor,pending_cash_minor,
      confirmed_setoff_minor,outstanding_minor,available_minor
    INTO balance FROM bn005_obligation_balances WHERE obligation_id=oid;
    IF balance.original_minor IS NULL OR balance.outstanding_minor<0 OR
       balance.available_minor<0 THEN
      RAISE EXCEPTION 'BN-005 cash exceeds live debt after noncash application';
    END IF;
  ELSE
    FOR oid IN SELECT obligation_id FROM settlement_allocations
       WHERE settlement_id=NEW.id ORDER BY obligation_id
    LOOP
      PERFORM 1 FROM obligations WHERE id=oid FOR UPDATE;
      SELECT original_minor,confirmed_cash_minor,pending_cash_minor,
        confirmed_setoff_minor,outstanding_minor,available_minor
      INTO balance FROM bn005_obligation_balances WHERE obligation_id=oid;
      IF balance.original_minor IS NULL OR balance.outstanding_minor<0 OR
         balance.available_minor<0 THEN
        RAISE EXCEPTION 'BN-005 settlement transition exceeds live debt';
      END IF;
    END LOOP;
  END IF;
  RETURN NULL;
END;$bn005$;
CREATE CONSTRAINT TRIGGER bn005_cash_allocation_guard
  AFTER INSERT OR UPDATE OR DELETE ON settlement_allocations
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  EXECUTE FUNCTION bn005_assert_cash_capacity();
CREATE CONSTRAINT TRIGGER bn005_cash_transition_guard
  AFTER UPDATE ON settlements
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  EXECUTE FUNCTION bn005_assert_cash_capacity();

-- Enforce the BN-004 invariant even for a direct SQL application:
-- the already-applied ledger must not have a source whose eventual
-- original available amount was booked twice by cash.
CREATE FUNCTION bn005_assert_noncash_capacity() RETURNS trigger LANGUAGE plpgsql AS $bn005$
DECLARE balance record;
BEGIN
  SELECT original_minor,confirmed_cash_minor,pending_cash_minor,
    confirmed_setoff_minor,outstanding_minor,available_minor
  INTO balance FROM bn005_obligation_balances WHERE obligation_id=NEW.obligation_id;
  IF balance.original_minor IS NULL OR balance.outstanding_minor<0 OR
     balance.available_minor<0 THEN
    RAISE EXCEPTION 'BN-005 setoff would overdraw original obligation';
  END IF;
  RETURN NULL;
END;$bn005$;
CREATE CONSTRAINT TRIGGER bn005_noncash_guard
  AFTER INSERT ON group_settlement_bilateral_application_allocations
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  EXECUTE FUNCTION bn005_assert_noncash_capacity();

-- SC-004's frozen invoice completion guard originally recognized CASH only.
-- Preserve every immutable-source and creator-only constraint while
-- accepting an already-applied BN-004 noncash discharge as equally final.
CREATE OR REPLACE FUNCTION sc004_guard_frozen_expense()
RETURNS trigger LANGUAGE plpgsql AS $bn005$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM group_settlement_cycle_snapshot_expenses se
    JOIN group_settlement_cycles c ON c.id=se.cycle_id
    WHERE se.expense_id=OLD.id AND c.state='locked'
  ) THEN RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END; END IF;
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'Frozen cycle expense cannot be deleted';
  END IF;
  IF OLD.completed_at IS NULL AND NEW.completed_at IS NOT NULL
    AND NEW.completed_by=OLD.created_by AND NEW.version=OLD.version+1
    AND (to_jsonb(NEW)-'completed_at'-'completed_by'-'version'-'updated_at')
       =(to_jsonb(OLD)-'completed_at'-'completed_by'-'version'-'updated_at')
  THEN
    IF EXISTS(
      SELECT 1 FROM obligations o
      JOIN bn005_obligation_balances b ON b.obligation_id=o.id
      WHERE o.expense_id=OLD.id AND o.voided_at IS NULL
        AND (b.outstanding_minor<>0 OR b.pending_cash_minor<>0 OR
             b.available_minor<0)
    ) THEN RAISE EXCEPTION
      'Unpaid or pending debt prevents completing frozen invoice'; END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Frozen cycle expense can only be creator-completed';
END;$bn005$;
