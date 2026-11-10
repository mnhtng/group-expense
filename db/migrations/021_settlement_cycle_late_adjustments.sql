-- SC-006 only: immutable, source-preserving LATE BILL attribution to
-- the earliest eligible following REVIEW cycle. Never create cloned bills,
-- mutate a locked original snapshot, or rewrite historic money.
CREATE TABLE group_settlement_cycle_adjustments(
  id uuid PRIMARY KEY,
  group_id uuid NOT NULL REFERENCES groups(id) ON DELETE RESTRICT,
  origin_cycle_id uuid NOT NULL,
  target_cycle_id uuid NOT NULL,
  expense_id uuid NOT NULL,
  expense_version integer NOT NULL CHECK(expense_version>0),
  actor_id text NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
  request_key uuid NOT NULL,
  kind text NOT NULL DEFAULT 'late_invoice' CHECK(kind='late_invoice'),
  note varchar(500) NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT sc006_distinct_cycle CHECK(origin_cycle_id<>target_cycle_id),
  CONSTRAINT sc006_unique_original_invoice UNIQUE(expense_id),
  CONSTRAINT sc006_adjustment_request_unique UNIQUE(group_id,actor_id,request_key),
  CONSTRAINT sc006_origin_group_fk FOREIGN KEY(origin_cycle_id,group_id)
    REFERENCES group_settlement_cycles(id,group_id) ON DELETE RESTRICT,
  CONSTRAINT sc006_target_group_fk FOREIGN KEY(target_cycle_id,group_id)
    REFERENCES group_settlement_cycles(id,group_id) ON DELETE RESTRICT,
  CONSTRAINT sc006_expense_group_fk FOREIGN KEY(expense_id,group_id)
    REFERENCES expenses(id,group_id) ON DELETE RESTRICT
);
CREATE INDEX sc006_adjustments_target ON group_settlement_cycle_adjustments
  (group_id,target_cycle_id,created_at,expense_id);
CREATE INDEX sc006_adjustments_origin ON group_settlement_cycle_adjustments
  (group_id,origin_cycle_id,created_at,expense_id);

CREATE FUNCTION sc006_guard_adjustment() RETURNS trigger LANGUAGE plpgsql AS $sc006$
DECLARE orig record;target record;bill record; old_cutoff timestamptz;
BEGIN
  IF TG_OP<>'INSERT' THEN
    RAISE EXCEPTION 'SC-006 adjustment audit is immutable';
  END IF;
  PERFORM 1 FROM groups WHERE id=NEW.group_id AND archived_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SC-006 group inactive'; END IF;
  IF NOT EXISTS(
    SELECT 1 FROM group_settlement_settings
    WHERE group_id=NEW.group_id AND requested_enabled=true)
  THEN RAISE EXCEPTION 'SC-006 feature not opted in'; END IF;
  IF NOT EXISTS(
    SELECT 1 FROM group_members WHERE group_id=NEW.group_id
      AND user_id=NEW.actor_id AND status='active')
    OR NOT EXISTS(
      SELECT 1 FROM groups g WHERE g.id=NEW.group_id AND g.owner_id=NEW.actor_id
      UNION ALL
      SELECT 1 FROM group_settlement_manager_grants gr
      WHERE gr.group_id=NEW.group_id AND gr.user_id=NEW.actor_id
        AND gr.revoked_at IS NULL)
  THEN RAISE EXCEPTION 'SC-006 requires owner or authorized manager'; END IF;

  SELECT * INTO orig FROM group_settlement_cycles
    WHERE id=NEW.origin_cycle_id AND group_id=NEW.group_id;
  SELECT * INTO target FROM group_settlement_cycles
    WHERE id=NEW.target_cycle_id AND group_id=NEW.group_id FOR UPDATE;
  IF orig.id IS NULL OR target.id IS NULL OR
     orig.state<>'locked' OR target.state<>'review' OR target.version<>2 OR
     orig.period_end>target.period_start
  THEN RAISE EXCEPTION 'SC-006 requires historical LOCKED and next REVIEW cycle'; END IF;
  -- Cannot skip an earlier not-yet-locked future cycle.
  IF EXISTS(SELECT 1 FROM group_settlement_cycles c
      WHERE c.group_id=NEW.group_id AND
        c.period_start>=orig.period_end
        AND c.period_start<target.period_start AND c.state IN('open','review'))
  THEN RAISE EXCEPTION 'SC-006 must target earliest future unlocked cycle'; END IF;
  SELECT cutoff_at INTO old_cutoff FROM group_settlement_cycle_snapshots
    WHERE cycle_id=NEW.origin_cycle_id AND group_id=NEW.group_id;
  IF old_cutoff IS NULL THEN RAISE EXCEPTION 'SC-006 origin snapshot missing'; END IF;
  SELECT * INTO bill FROM expenses
    WHERE id=NEW.expense_id AND group_id=NEW.group_id FOR UPDATE;
  IF bill.id IS NULL OR bill.deleted_at IS NOT NULL OR
     bill.version<>NEW.expense_version OR
     bill.occurred_on<orig.period_start OR bill.occurred_on>=orig.period_end OR
     (bill.created_at<=old_cutoff AND bill.updated_at<=old_cutoff) OR
     EXISTS(SELECT 1 FROM group_settlement_cycle_snapshot_expenses se
       WHERE se.expense_id=NEW.expense_id)
  THEN RAISE EXCEPTION 'SC-006 invoice not an unrecorded historical late source'; END IF;
  RETURN NEW;
END;$sc006$;
CREATE TRIGGER sc006_adjustment_guard BEFORE INSERT OR UPDATE OR DELETE
  ON group_settlement_cycle_adjustments FOR EACH ROW EXECUTE FUNCTION sc006_guard_adjustment();

-- The existing frozen-invoice source rules extend to attributed invoices
-- immediately, even before the later REVIEW cycle is sealed.
-- Creator-only completion is STILL the only permitted invoice UPDATE.

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
        AND s.original_minor=(
          SELECT COALESCE(sum(o.original_minor),0)
          FROM group_settlement_cycle_snapshot_obligations o WHERE o.cycle_id=NEW.id)
        AND s.confirmed_cash_minor=(
          SELECT COALESCE(sum(o.confirmed_cash_minor),0)
          FROM group_settlement_cycle_snapshot_obligations o WHERE o.cycle_id=NEW.id)
        AND s.pending_cash_minor=(
          SELECT COALESCE(sum(o.pending_cash_minor),0)
          FROM group_settlement_cycle_snapshot_obligations o WHERE o.cycle_id=NEW.id)
        AND s.outstanding_minor=(
          SELECT COALESCE(sum(o.outstanding_minor),0)
          FROM group_settlement_cycle_snapshot_obligations o WHERE o.cycle_id=NEW.id)
        AND s.available_minor=(
          SELECT COALESCE(sum(o.available_minor),0)
          FROM group_settlement_cycle_snapshot_obligations o WHERE o.cycle_id=NEW.id)
        AND NOT EXISTS(
          SELECT 1 FROM group_settlement_cycle_snapshot_expenses e
          WHERE e.cycle_id=NEW.id
            AND (e.occurred_on<NEW.period_start OR e.occurred_on>=NEW.period_end)
          AND NOT EXISTS(SELECT 1 FROM group_settlement_cycle_adjustments adj
            WHERE adj.target_cycle_id=NEW.id AND adj.expense_id=e.expense_id)
        )
        AND s.cutoff_at>=OLD.reviewed_at AND s.cutoff_at<=NEW.locked_at
        AND s.expense_count=(
          SELECT count(*) FROM expenses live
          WHERE live.group_id=NEW.group_id AND live.deleted_at IS NULL
            AND ( (live.occurred_on>=NEW.period_start AND live.occurred_on<NEW.period_end)
              OR EXISTS(SELECT 1 FROM group_settlement_cycle_adjustments adj
                WHERE adj.target_cycle_id=NEW.id AND adj.expense_id=live.id))
            AND live.created_at<=s.cutoff_at)
        AND s.obligation_count=(
          SELECT count(*) FROM obligations live
          JOIN expenses e ON e.id=live.expense_id AND e.group_id=NEW.group_id
          WHERE live.group_id=NEW.group_id AND live.voided_at IS NULL
            AND e.deleted_at IS NULL
            AND ((e.occurred_on>=NEW.period_start AND e.occurred_on<NEW.period_end)
              OR EXISTS(SELECT 1 FROM group_settlement_cycle_adjustments adj
                WHERE adj.target_cycle_id=NEW.id AND adj.expense_id=e.id))
            AND e.created_at<=s.cutoff_at AND live.created_at<=s.cutoff_at)
        AND NOT EXISTS(
          SELECT 1 FROM group_settlement_cycle_snapshot_expenses se
          JOIN expenses live ON live.id=se.expense_id
          WHERE se.cycle_id=NEW.id
            AND (((se.occurred_on<NEW.period_start OR se.occurred_on>=NEW.period_end)
                AND NOT EXISTS(SELECT 1 FROM group_settlement_cycle_adjustments adj
                  WHERE adj.target_cycle_id=NEW.id AND adj.expense_id=se.expense_id))
               OR live.deleted_at IS NOT NULL OR live.version<>se.expense_version
               OR live.total_minor<>se.total_minor
               OR live.occurred_on<>se.occurred_on
               OR live.payer_id<>se.payer_id
               OR live.created_by<>se.created_by)
        )
        AND NOT EXISTS(
          SELECT 1 FROM group_settlement_cycle_snapshot_obligations o
          JOIN obligations base ON base.id=o.obligation_id
          LEFT JOIN LATERAL (
            SELECT COALESCE(sum(a.amount_minor) FILTER(WHERE st.status='confirmed'),0)
               AS confirmed,
              COALESCE(sum(a.amount_minor) FILTER(WHERE st.status='pending'),0)
               AS pending
            FROM settlement_allocations a
            JOIN settlements st ON st.id=a.settlement_id
            WHERE a.obligation_id=o.obligation_id
          ) paid ON true
          WHERE o.cycle_id=NEW.id AND (
            base.voided_at IS NOT NULL OR base.amount_minor<>o.original_minor
            OR base.expense_version<>o.expense_version
            OR o.confirmed_cash_minor<>paid.confirmed
            OR o.pending_cash_minor<>paid.pending)
        )
    ) INTO snapshot_exists;
    IF snapshot_exists THEN RETURN NEW; END IF;
  END IF;
  RAISE EXCEPTION 'Invalid cycle state transition or incomplete financial snapshot';
END;
$sc004$;

CREATE OR REPLACE FUNCTION sc004_guard_frozen_expense()
RETURNS trigger LANGUAGE plpgsql AS $bn005$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM group_settlement_cycle_snapshot_expenses se
    JOIN group_settlement_cycles c ON c.id=se.cycle_id
    WHERE se.expense_id=OLD.id AND c.state='locked'
  ) AND NOT EXISTS (
    SELECT 1 FROM group_settlement_cycle_adjustments adj
    WHERE adj.expense_id=OLD.id
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

CREATE OR REPLACE FUNCTION sc004_guard_frozen_items() RETURNS trigger LANGUAGE plpgsql AS $sc004$
DECLARE old_expense uuid; new_expense uuid;
BEGIN
  -- Check BOTH source and destination. Moving an item/share OUT of a frozen
  -- invoice must not bypass immutable historical source constraints.
  IF TG_TABLE_NAME='expense_items' THEN
    IF TG_OP<>'INSERT' THEN old_expense=OLD.expense_id; END IF;
    IF TG_OP<>'DELETE' THEN new_expense=NEW.expense_id; END IF;
  ELSE
    IF TG_OP<>'INSERT' THEN
      SELECT expense_id INTO old_expense FROM expense_items WHERE id=OLD.item_id;
    END IF;
    IF TG_OP<>'DELETE' THEN
      SELECT expense_id INTO new_expense FROM expense_items WHERE id=NEW.item_id;
    END IF;
  END IF;
  IF EXISTS(SELECT 1 FROM group_settlement_cycle_snapshot_expenses se
    JOIN group_settlement_cycles c ON c.id=se.cycle_id
    WHERE se.expense_id=ANY(ARRAY[old_expense,new_expense])
      AND c.state='locked')
    OR EXISTS(SELECT 1 FROM group_settlement_cycle_adjustments adj
      WHERE adj.expense_id=ANY(ARRAY[old_expense,new_expense])) THEN
    RAISE EXCEPTION 'Frozen invoice item shares cannot change';
  END IF;
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END;
$sc004$;

CREATE OR REPLACE FUNCTION sc004_guard_frozen_obligation() RETURNS trigger LANGUAGE plpgsql AS $sc004$
DECLARE oid uuid;
BEGIN
  oid=CASE WHEN TG_OP='INSERT' THEN NEW.id ELSE OLD.id END;
  IF EXISTS (SELECT 1 FROM group_settlement_cycle_snapshot_obligations so
    JOIN group_settlement_cycles c ON c.id=so.cycle_id
    WHERE so.obligation_id=oid AND c.state='locked') OR
     (TG_OP IN ('INSERT','UPDATE') AND EXISTS (
       SELECT 1 FROM group_settlement_cycle_snapshot_expenses se
       JOIN group_settlement_cycles c ON c.id=se.cycle_id
       WHERE se.expense_id=NEW.expense_id AND c.state='locked'
     )) OR
     EXISTS(SELECT 1 FROM group_settlement_cycle_adjustments adj
       WHERE adj.expense_id=CASE WHEN TG_OP='DELETE'
         THEN OLD.expense_id ELSE NEW.expense_id END) THEN
    RAISE EXCEPTION 'Frozen obligation cannot be modified or deleted';
  END IF;
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END;
$sc004$;
