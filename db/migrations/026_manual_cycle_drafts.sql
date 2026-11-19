-- SC-026: retroactive manual periods, mutable only as OPEN drafts.
-- No CASH/NONCASH/obligation/snapshot schema or money writer changes.
-- Keep all older migration checksums intact; preserve immutable cycle IDs
-- and events even for periods the user cancels in the UI.
ALTER TABLE group_settlement_cycles
  ADD COLUMN draft_revision integer NOT NULL DEFAULT 0 CHECK (draft_revision>=0),
  ADD COLUMN cancelled_at timestamptz,
  ADD COLUMN cancelled_by text REFERENCES "user"(id) ON DELETE RESTRICT,
  ADD CONSTRAINT sc026_cancelled_draft_consistent CHECK (
    (cancelled_at IS NULL AND cancelled_by IS NULL)
    OR (cancelled_at IS NOT NULL AND cancelled_by IS NOT NULL
        AND source='manual' AND state='open'
        AND reviewed_at IS NULL AND locked_at IS NULL AND locked_by IS NULL)
  );

-- Cancelled draft periods release their calendar slot without deleting
-- source identities or their append-only lifecycle event history.
ALTER TABLE group_settlement_cycles DROP CONSTRAINT cycle_group_no_overlap;
ALTER TABLE group_settlement_cycles ADD CONSTRAINT cycle_group_no_overlap
  EXCLUDE USING gist
  (group_id WITH =, tstzrange(start_at,end_at,'[)') WITH &&)
  WHERE (cancelled_at IS NULL);
CREATE INDEX sc026_active_cycles ON group_settlement_cycles
  (group_id,start_at DESC,id DESC) WHERE cancelled_at IS NULL;

-- Separate draft revisions from the frozen state-machine version 1/2/3:
-- edits never change the meaning of review/lock event versioning.
CREATE TABLE group_settlement_cycle_draft_events (
  id uuid PRIMARY KEY,
  group_id uuid NOT NULL,
  cycle_id uuid NOT NULL,
  draft_revision integer NOT NULL CHECK (draft_revision>0),
  actor_id text NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (event_type IN ('period_updated','period_cancelled')),
  old_period_start date NOT NULL,
  old_period_end date NOT NULL,
  new_period_start date,
  new_period_end date,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT sc026_draft_event_cycle FOREIGN KEY(cycle_id,group_id)
    REFERENCES group_settlement_cycles(id,group_id) ON DELETE RESTRICT,
  CONSTRAINT sc026_draft_event_unique UNIQUE(cycle_id,draft_revision),
  CONSTRAINT sc026_draft_event_shape CHECK (
    (event_type='period_updated'
       AND new_period_start IS NOT NULL AND new_period_end IS NOT NULL
       AND new_period_start<new_period_end)
    OR (event_type='period_cancelled'
       AND new_period_start IS NULL AND new_period_end IS NULL)
  )
);
CREATE INDEX sc026_draft_events_by_cycle
  ON group_settlement_cycle_draft_events(cycle_id,recorded_at DESC);
CREATE FUNCTION sc026_guard_draft_audit() RETURNS trigger
  LANGUAGE plpgsql AS $sc026$
BEGIN
  RAISE EXCEPTION 'Cycle draft history is append-only';
END;
$sc026$;
CREATE TRIGGER sc026_draft_events_immutable BEFORE UPDATE OR DELETE
  ON group_settlement_cycle_draft_events
  FOR EACH ROW EXECUTE FUNCTION sc026_guard_draft_audit();

-- Preserve the final SC-006/SC-004 snapshot-integrity guard verbatim,
-- adding only narrowly-scoped, audited OPEN manual draft transitions.
CREATE OR REPLACE FUNCTION sc003_guard_cycle() RETURNS trigger LANGUAGE plpgsql AS $sc004$
DECLARE snapshot_exists boolean;
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'Settlement cycles cannot be deleted';
  END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.state<>'open' OR NEW.version<>1 OR NEW.reviewed_at IS NOT NULL
       OR NEW.locked_at IS NOT NULL OR NEW.locked_by IS NOT NULL
       OR NEW.draft_revision<>0 OR NEW.cancelled_at IS NOT NULL
       OR NEW.cancelled_by IS NOT NULL THEN
      RAISE EXCEPTION 'Cycle must be created OPEN at version 1';
    END IF;
    RETURN NEW;
  END IF;
  -- A manually created OPEN period is a draft until review. Keep the stable
  -- lifecycle version (1->2->3) and independently version draft changes.
  -- All identity fields, financial state and existing snapshot guards remain.
  IF OLD.cancelled_at IS NOT NULL THEN
    RAISE EXCEPTION 'A cancelled cycle is immutable';
  END IF;
  IF OLD.source='manual' AND OLD.state='open'
     AND OLD.reviewed_at IS NULL AND OLD.locked_at IS NULL
     AND NEW.state='open' AND NEW.version=OLD.version
     AND NEW.draft_revision=OLD.draft_revision+1
     AND NEW.updated_at>=OLD.updated_at THEN
    IF NEW.cancelled_at IS NULL AND NEW.cancelled_by IS NULL
       AND (NEW.period_start<>OLD.period_start OR NEW.period_end<>OLD.period_end)
       AND NEW.period_start<NEW.period_end
       AND NEW.start_at<NEW.end_at
       AND (to_jsonb(NEW)-'period_start'-'period_end'-'start_at'
         -'end_at'-'draft_revision'-'updated_at')
         = (to_jsonb(OLD)-'period_start'-'period_end'-'start_at'
         -'end_at'-'draft_revision'-'updated_at')
    THEN RETURN NEW;
    END IF;
    IF NEW.cancelled_at IS NOT NULL AND NEW.cancelled_by IS NOT NULL
       AND (to_jsonb(NEW)-'cancelled_at'-'cancelled_by'
         -'draft_revision'-'updated_at')
         = (to_jsonb(OLD)-'cancelled_at'-'cancelled_by'
         -'draft_revision'-'updated_at')
    THEN RETURN NEW;
    END IF;
  END IF;
  IF OLD.state='open' AND NEW.state='review'
     AND OLD.cancelled_at IS NULL
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
