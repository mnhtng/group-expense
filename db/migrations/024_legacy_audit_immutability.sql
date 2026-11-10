-- RR-004: enforce existing append-only audit promises at the SQL boundary.
-- No source rows, payment states, amounts or historical events are rewritten.
CREATE FUNCTION rr004_immutable_legacy_audit() RETURNS trigger LANGUAGE plpgsql AS $rr004$
BEGIN
  -- Preserve the established SC-005 error contract for cycle CASH history.
  IF TG_TABLE_NAME='settlement_events' AND TG_OP<>'TRUNCATE' THEN
    IF EXISTS(SELECT 1 FROM group_settlement_cycle_repayments
      WHERE settlement_id=OLD.settlement_id) THEN
      RAISE EXCEPTION 'SC-005 settlement events are append-only';
    END IF;
  END IF;
  RAISE EXCEPTION 'RR-004 audit history is immutable';
END;$rr004$;

CREATE TRIGGER rr004_expense_audit_immutable BEFORE UPDATE OR DELETE ON expense_events
 FOR EACH ROW EXECUTE FUNCTION rr004_immutable_legacy_audit();
CREATE TRIGGER rr004_completion_audit_immutable BEFORE UPDATE OR DELETE ON expense_completion_events
 FOR EACH ROW EXECUTE FUNCTION rr004_immutable_legacy_audit();
CREATE TRIGGER rr004_cash_audit_immutable BEFORE UPDATE OR DELETE ON settlement_events
 FOR EACH ROW EXECUTE FUNCTION rr004_immutable_legacy_audit();
CREATE TRIGGER rr004_membership_audit_immutable BEFORE UPDATE OR DELETE ON group_membership_events
 FOR EACH ROW EXECUTE FUNCTION rr004_immutable_legacy_audit();
CREATE TRIGGER rr004_note_audit_immutable BEFORE UPDATE OR DELETE ON group_note_events
 FOR EACH ROW EXECUTE FUNCTION rr004_immutable_legacy_audit();
CREATE TRIGGER rr004_config_audit_immutable BEFORE UPDATE OR DELETE ON group_settlement_config_events
 FOR EACH ROW EXECUTE FUNCTION rr004_immutable_legacy_audit();

CREATE TRIGGER rr004_expense_audit_no_truncate BEFORE TRUNCATE ON expense_events
 FOR EACH STATEMENT EXECUTE FUNCTION rr004_immutable_legacy_audit();
CREATE TRIGGER rr004_completion_audit_no_truncate BEFORE TRUNCATE ON expense_completion_events
 FOR EACH STATEMENT EXECUTE FUNCTION rr004_immutable_legacy_audit();
CREATE TRIGGER rr004_cash_audit_no_truncate BEFORE TRUNCATE ON settlement_events
 FOR EACH STATEMENT EXECUTE FUNCTION rr004_immutable_legacy_audit();
CREATE TRIGGER rr004_membership_audit_no_truncate BEFORE TRUNCATE ON group_membership_events
 FOR EACH STATEMENT EXECUTE FUNCTION rr004_immutable_legacy_audit();
CREATE TRIGGER rr004_note_audit_no_truncate BEFORE TRUNCATE ON group_note_events
 FOR EACH STATEMENT EXECUTE FUNCTION rr004_immutable_legacy_audit();
CREATE TRIGGER rr004_config_audit_no_truncate BEFORE TRUNCATE ON group_settlement_config_events
 FOR EACH STATEMENT EXECUTE FUNCTION rr004_immutable_legacy_audit();
