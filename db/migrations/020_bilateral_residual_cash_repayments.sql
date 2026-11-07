-- BN-006: a NEW, ordinary PENDING cash settlement for the ONE residual
-- direction of a previously applied BN-004 two-person NONCASH proof.
-- This provenance is append-only; actual money is still controlled by
-- settlements.status and the independent real counterparty's confirmation.
CREATE TABLE group_settlement_bilateral_residual_repayments (
  settlement_id uuid PRIMARY KEY REFERENCES group_settlement_cycle_repayments(settlement_id)
    ON DELETE RESTRICT,
  application_id uuid NOT NULL REFERENCES group_settlement_bilateral_applications(id)
    ON DELETE RESTRICT,
  group_id uuid NOT NULL,
  cycle_id uuid NOT NULL,
  debtor_id text NOT NULL,
  creditor_id text NOT NULL,
  initiated_by text NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
  preview_fingerprint char(64) NOT NULL CHECK(preview_fingerprint ~ '^[0-9a-f]{64}$'),
  request_digest char(64) NOT NULL CHECK(request_digest ~ '^[0-9a-f]{64}$'),
  amount_minor bigint NOT NULL CHECK(amount_minor>0),
  allocation_count integer NOT NULL CHECK(allocation_count>0 AND allocation_count<=20000),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK(debtor_id<>creditor_id AND initiated_by IN(debtor_id,creditor_id)),
  FOREIGN KEY(group_id,debtor_id) REFERENCES group_members(group_id,user_id)
    ON DELETE RESTRICT,
  FOREIGN KEY(group_id,creditor_id) REFERENCES group_members(group_id,user_id)
    ON DELETE RESTRICT
);
CREATE INDEX bn006_residual_provenance_idx
  ON group_settlement_bilateral_residual_repayments
  (application_id,created_at DESC,settlement_id);

CREATE FUNCTION bn006_immutable_provenance() RETURNS trigger LANGUAGE plpgsql AS $bn006$
BEGIN
  RAISE EXCEPTION 'BN-006 residual cash provenance is append-only';
END;$bn006$;
CREATE TRIGGER bn006_residual_audit_immutable
 BEFORE UPDATE OR DELETE ON group_settlement_bilateral_residual_repayments
 FOR EACH ROW EXECUTE FUNCTION bn006_immutable_provenance();

-- An application row must point to the EXACT original locked cycle,
-- canonical two-person pair, and ordinary SC-005 original cash batch.
-- Validate *after* all cash allocations and pending reservation exist.
-- The new pending allocation contributes to BN-005 pending_cash but NOT
-- outstanding, so this validation uses outstanding for the principal
-- and subtracts this new request from pending to find earlier holds.
CREATE FUNCTION bn006_validate_residual() RETURNS trigger LANGUAGE plpgsql AS $bn006$
DECLARE
  a record; st record; provenance record;
  sum_forward numeric; sum_backward numeric;
  pending_existing numeric; eligible_count integer;
  eligible_amount numeric; due_count integer;
BEGIN
  PERFORM 1 FROM groups WHERE id=NEW.group_id AND archived_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'BN-006 inactive group'; END IF;

  SELECT * INTO a FROM group_settlement_bilateral_applications
    WHERE id=NEW.application_id;
  SELECT * INTO st FROM settlements WHERE id=NEW.settlement_id;
  SELECT * INTO provenance FROM group_settlement_cycle_repayments
    WHERE settlement_id=NEW.settlement_id;
  IF a.id IS NULL OR st.id IS NULL OR provenance.settlement_id IS NULL
    OR a.group_id<>NEW.group_id OR a.cycle_id<>NEW.cycle_id
    OR st.group_id<>NEW.group_id OR provenance.group_id<>NEW.group_id
    OR provenance.cycle_id<>NEW.cycle_id
    OR st.status<>'pending' OR st.amount_minor<>NEW.amount_minor
    OR provenance.amount_minor<>NEW.amount_minor
    OR st.initiated_by<>NEW.initiated_by
    OR provenance.initiated_by<>NEW.initiated_by
    OR st.debtor_id<>NEW.debtor_id OR st.creditor_id<>NEW.creditor_id
    OR provenance.debtor_id<>NEW.debtor_id OR provenance.creditor_id<>NEW.creditor_id
    OR st.request_fingerprint<>NEW.request_digest
    OR provenance.preview_fingerprint<>NEW.preview_fingerprint
    OR provenance.allocation_count<>NEW.allocation_count
    OR NOT(
      (NEW.debtor_id=a.party_low AND NEW.creditor_id=a.party_high) OR
      (NEW.debtor_id=a.party_high AND NEW.creditor_id=a.party_low))
    THEN RAISE EXCEPTION 'BN-006 forged residual provenance'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM group_settlement_cycles c
    JOIN group_settlement_cycle_snapshots snap
      ON snap.cycle_id=c.id AND snap.group_id=c.group_id
    JOIN group_settlement_settings cfg ON cfg.group_id=c.group_id
    WHERE c.id=NEW.cycle_id AND c.group_id=NEW.group_id
      AND c.state='locked' AND c.version=3
      AND snap.fingerprint=a.snapshot_fingerprint
      AND cfg.requested_enabled AND cfg.requested_bilateral_netting
  ) OR (
    SELECT count(*) FROM group_members m
    WHERE m.group_id=NEW.group_id AND m.status='active'
      AND m.user_id IN(a.party_low,a.party_high)
  )<>2 THEN
    RAISE EXCEPTION 'BN-006 cycle, netting or participants inactive'; END IF;

  -- No late mutation of frozen source and no imported or third-party debt.
  IF EXISTS (
    SELECT 1 FROM group_settlement_cycle_snapshot_obligations src
    JOIN obligations o ON o.id=src.obligation_id AND o.group_id=src.group_id
    JOIN expenses e ON e.id=o.expense_id AND e.group_id=src.group_id
    WHERE src.cycle_id=NEW.cycle_id AND src.group_id=NEW.group_id
      AND ((src.debtor_id=a.party_low AND src.creditor_id=a.party_high)
        OR (src.debtor_id=a.party_high AND src.creditor_id=a.party_low))
      AND (o.voided_at IS NOT NULL OR e.deleted_at IS NOT NULL
        OR o.amount_minor<>src.original_minor
        OR o.expense_version<>src.expense_version
        OR (e.version<>src.expense_version AND NOT (
          e.version=src.expense_version+1 AND e.completed_at IS NOT NULL
          AND e.completed_by=e.created_by)))
  ) THEN RAISE EXCEPTION 'BN-006 original source changed'; END IF;

  SELECT
    COALESCE(sum(b.outstanding_minor) FILTER
      (WHERE o.debtor_id=NEW.debtor_id AND o.creditor_id=NEW.creditor_id),0),
    COALESCE(sum(b.outstanding_minor) FILTER
      (WHERE o.debtor_id=NEW.creditor_id AND o.creditor_id=NEW.debtor_id),0),
    COALESCE(sum(b.pending_cash_minor),0),
    count(*) FILTER(WHERE o.debtor_id=NEW.debtor_id
      AND o.creditor_id=NEW.creditor_id AND b.outstanding_minor>0)::int
    INTO sum_forward,sum_backward,pending_existing,due_count
  FROM group_settlement_cycle_snapshot_obligations src
  JOIN obligations o ON o.id=src.obligation_id AND o.group_id=src.group_id
  JOIN bn005_obligation_balances b ON b.obligation_id=o.id
  WHERE src.cycle_id=NEW.cycle_id AND src.group_id=NEW.group_id
    AND ((src.debtor_id=a.party_low AND src.creditor_id=a.party_high)
      OR (src.debtor_id=a.party_high AND src.creditor_id=a.party_low));
  IF sum_forward<>NEW.amount_minor OR sum_backward<>0
    OR pending_existing<>NEW.amount_minor OR due_count<>NEW.allocation_count
    THEN RAISE EXCEPTION 'BN-006 not exactly one net residual direction, or pending cash remains'; END IF;

  SELECT count(*)::int,COALESCE(sum(sa.amount_minor),0)
    INTO eligible_count,eligible_amount
  FROM settlement_allocations sa
  JOIN group_settlement_cycle_snapshot_obligations src
    ON src.obligation_id=sa.obligation_id AND src.group_id=sa.group_id
      AND src.cycle_id=NEW.cycle_id
  JOIN obligations o ON o.id=sa.obligation_id
  JOIN bn005_obligation_balances b ON b.obligation_id=sa.obligation_id
  WHERE sa.settlement_id=NEW.settlement_id AND sa.group_id=NEW.group_id
    AND sa.debtor_id=NEW.debtor_id AND sa.creditor_id=NEW.creditor_id
    AND sa.amount_minor=b.outstanding_minor
    AND b.available_minor=0;
  IF eligible_count<>NEW.allocation_count OR eligible_amount<>NEW.amount_minor
    OR EXISTS(
      SELECT 1 FROM settlement_allocations sa
      WHERE sa.settlement_id=NEW.settlement_id
      AND NOT EXISTS(
        SELECT 1 FROM group_settlement_cycle_snapshot_obligations src
        WHERE src.cycle_id=NEW.cycle_id AND src.group_id=NEW.group_id
          AND src.obligation_id=sa.obligation_id
          AND src.debtor_id=NEW.debtor_id AND src.creditor_id=NEW.creditor_id
      )
    ) OR EXISTS(
      SELECT 1 FROM group_settlement_cycle_snapshot_obligations src
      JOIN obligations o ON o.id=src.obligation_id AND o.group_id=src.group_id
      JOIN bn005_obligation_balances b ON b.obligation_id=o.id
      WHERE src.cycle_id=NEW.cycle_id AND src.group_id=NEW.group_id
        AND src.debtor_id=NEW.debtor_id AND src.creditor_id=NEW.creditor_id
        AND b.outstanding_minor>0
        AND NOT EXISTS(
          SELECT 1 FROM settlement_allocations sa
          WHERE sa.settlement_id=NEW.settlement_id AND sa.obligation_id=o.id
            AND sa.amount_minor=b.outstanding_minor
        )
    ) THEN
    RAISE EXCEPTION 'BN-006 missing, foreign or noncanonical cash source allocation';
  END IF;
  RETURN NEW;
END;$bn006$;
CREATE TRIGGER bn006_residual_write_guard
  BEFORE INSERT ON group_settlement_bilateral_residual_repayments
  FOR EACH ROW EXECUTE FUNCTION bn006_validate_residual();
