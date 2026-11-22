-- SC-032: Owner/manager may update historical MANUAL periods or cancel any
-- unfinalized (OPEN/REVIEW) period. LOCKED and completed periods are immutable.
-- This migration is additive in behavior only: no changes to money, invoices,
-- existing cycle records, or prior migration checksums.
--
-- Scheduled period *dates* remain controlled by the recurring calendar.
-- Cancellation is soft/audited; the cron cursor includes the tombstone and
-- will not re-create cancelled scheduled slots.
ALTER TABLE group_settlement_cycles
  DROP CONSTRAINT sc026_cancelled_draft_consistent,
  ADD CONSTRAINT sc026_cancelled_draft_consistent CHECK (
    (cancelled_at IS NULL AND cancelled_by IS NULL)
    OR (cancelled_at IS NOT NULL AND cancelled_by IS NOT NULL
        AND state IN ('open','review') AND locked_at IS NULL AND locked_by IS NULL)
  );

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
  -- SC-032: OPEN and REVIEW are unlocked; immutable financial snapshots,
  -- late adjustments, and previous cancellation prevent modifications.
  -- Editing a REVIEW period keeps version 2 and reviewed_at for the immutable
  -- review event, but refreshes reviewed_at and increments draft_revision
  -- so concurrent clients must refresh their preview before any lock is allowed.
  IF OLD.cancelled_at IS NOT NULL THEN
    RAISE EXCEPTION 'A cancelled cycle is immutable';
  END IF;
  IF OLD.state IN ('open','review')
     AND OLD.locked_at IS NULL AND OLD.locked_by IS NULL
     AND NEW.state=OLD.state AND NEW.version=OLD.version
     AND NEW.draft_revision=OLD.draft_revision+1
     AND NEW.updated_at>=OLD.updated_at
     AND NOT EXISTS (
       SELECT 1 FROM group_settlement_cycle_snapshots s WHERE s.cycle_id=OLD.id)
     AND NOT EXISTS (
       SELECT 1 FROM group_settlement_cycle_adjustments a
       WHERE a.origin_cycle_id=OLD.id OR a.target_cycle_id=OLD.id)
  THEN
    IF OLD.source='manual'
      AND NEW.cancelled_at IS NULL AND NEW.cancelled_by IS NULL
      AND (NEW.period_start<>OLD.period_start OR NEW.period_end<>OLD.period_end)
      AND NEW.period_start<NEW.period_end AND NEW.start_at<NEW.end_at
      AND (
        (OLD.state='open' AND NEW.reviewed_at IS NULL)
        OR (OLD.state='review' AND NEW.end_at<=clock_timestamp()
          AND NEW.reviewed_at IS NOT NULL
          AND NEW.reviewed_at>=NEW.end_at
          AND NEW.reviewed_at>=OLD.reviewed_at)
      )
      AND (to_jsonb(NEW)-'period_start'-'period_end'-'start_at'
        -'end_at'-'reviewed_at'-'draft_revision'-'updated_at')
        = (to_jsonb(OLD)-'period_start'-'period_end'-'start_at'
        -'end_at'-'reviewed_at'-'draft_revision'-'updated_at')
    THEN RETURN NEW;
    END IF;
    -- Soft cancellation of either MANUAL or SCHEDULED unlocked periods.
    -- Scheduled periods retain their row/tombstone, so cron cannot refill
    -- the same slot during its next iteration.
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
