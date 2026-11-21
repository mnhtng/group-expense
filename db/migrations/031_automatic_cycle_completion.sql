-- SC-031: The financial snapshot stays LOCKED (version 3) forever.
-- Settlement completion is a distinct, append-only *result*, not a mutation
-- of snapshot state or original obligations. No ORM and no money changes.
CREATE TABLE group_settlement_cycle_completions (
  cycle_id uuid PRIMARY KEY,
  group_id uuid NOT NULL,
  completed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  origin text NOT NULL CHECK (origin IN ('automatic','backfill')),
  triggered_by text REFERENCES "user"(id) ON DELETE RESTRICT,
  CONSTRAINT sc031_origin_actor_check CHECK (
    (origin='automatic' AND triggered_by IS NOT NULL) OR
    (origin='backfill' AND triggered_by IS NULL)
  ),
  CONSTRAINT sc031_cycle_group_fk FOREIGN KEY(cycle_id,group_id)
    REFERENCES group_settlement_cycles(id,group_id) ON DELETE RESTRICT
);
CREATE INDEX sc031_completions_by_group
  ON group_settlement_cycle_completions(group_id,completed_at DESC);

-- The same eligibility predicate is used by the one-time historical
-- reconciliation and every future signed finance commit.
-- It reads the COMPLETE frozen source set, not the visible page, and checks
-- pending cash intents (which don't reserve original balance until confirmed).
CREATE FUNCTION sc031_cycle_ready(p_group uuid,p_cycle uuid)
RETURNS boolean LANGUAGE sql STABLE AS $sc031$
  SELECT EXISTS (
    SELECT 1 FROM group_settlement_cycles cy
    JOIN group_settlement_cycle_snapshots manifest
      ON manifest.cycle_id=cy.id AND manifest.group_id=cy.group_id
    WHERE cy.id=p_cycle AND cy.group_id=p_group
      AND cy.state='locked' AND cy.cancelled_at IS NULL
  )
  AND NOT EXISTS (
    SELECT 1 FROM group_settlement_cycle_snapshot_obligations src
    LEFT JOIN bn005_obligation_balances bal ON bal.obligation_id=src.obligation_id
    WHERE src.group_id=p_group AND src.cycle_id=p_cycle
      AND (bal.obligation_id IS NULL OR bal.outstanding_minor<>0
        OR bal.pending_cash_minor<>0
        OR bal.available_minor<>0 OR bal.original_minor<>
          bal.confirmed_cash_minor+bal.confirmed_setoff_minor)
  )
  AND NOT EXISTS (
    SELECT 1 FROM group_settlement_cycle_snapshot_expenses src
    JOIN expenses e ON e.id=src.expense_id AND e.group_id=src.group_id
    WHERE src.group_id=p_group AND src.cycle_id=p_cycle
      AND (e.completed_at IS NULL OR e.deleted_at IS NOT NULL)
  )
  AND NOT EXISTS (
    SELECT 1 FROM sc009_dispute_states d
    WHERE d.group_id=p_group AND d.cycle_id=p_cycle
      AND d.status IN ('open','awaiting_reporter')
  )
  AND NOT EXISTS (
    SELECT 1 FROM group_settlement_cycle_repayments cr
    JOIN settlements s ON s.id=cr.settlement_id
    WHERE cr.group_id=p_group AND cr.cycle_id=p_cycle AND s.status='pending'
  )
  AND NOT EXISTS (
    SELECT 1 FROM group_settlement_bilateral_cash_intents ci
    WHERE ci.group_id=p_group AND ci.cycle_id=p_cycle AND ci.status='pending'
  )
  AND NOT EXISTS (
    SELECT 1 FROM group_settlement_bilateral_heads h
    JOIN group_settlement_bilateral_proposals p ON p.id=h.current_proposal_id
    WHERE h.group_id=p_group AND h.cycle_id=p_cycle
      AND p.created_at>now()-interval '72 hours'
      AND NOT EXISTS (
        SELECT 1 FROM group_settlement_bilateral_applications app
        WHERE app.proposal_id=p.id
      )
      AND NOT EXISTS (
        SELECT 1 FROM group_settlement_bilateral_decision_events ev
        WHERE ev.proposal_id=p.id
          AND ev.event_type IN ('reject','revoke','invalidated','expired')
      )
  )
$sc031$;

-- Immutable completion proof. Attempts to rewrite history are rejected even
-- if an operator accidentally grants UPDATE or DELETE in the future.
CREATE FUNCTION sc031_guard_completion()
RETURNS trigger LANGUAGE plpgsql AS $sc031$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NOT sc031_cycle_ready(NEW.group_id,NEW.cycle_id) THEN
      RAISE EXCEPTION 'SC031 unsettled or blocked period cannot complete'
        USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'SC031 cycle completion is append-only'
    USING ERRCODE='23514';
END;
$sc031$;
CREATE TRIGGER sc031_completion_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON group_settlement_cycle_completions
  FOR EACH ROW EXECUTE FUNCTION sc031_guard_completion();
CREATE TRIGGER sc031_completion_no_truncate
  BEFORE TRUNCATE ON group_settlement_cycle_completions
  FOR EACH STATEMENT EXECUTE FUNCTION sc031_guard_completion();

-- A new dispute after completion would make an already finalized period
-- appear settled while a blocker is live. Post-period corrections go through
-- the existing audited late-adjustment process instead of reopening it.
CREATE FUNCTION sc031_reject_dispute_after_completion()
RETURNS trigger LANGUAGE plpgsql AS $sc031$
BEGIN
  IF EXISTS (
    SELECT 1 FROM group_settlement_cycle_completions
    WHERE group_id=NEW.group_id AND cycle_id=NEW.cycle_id
  ) THEN
    RAISE EXCEPTION 'Completed period cannot accept a new dispute'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$sc031$;
CREATE TRIGGER sc031_no_post_completion_dispute
  BEFORE INSERT ON group_settlement_cycle_disputes
  FOR EACH ROW EXECUTE FUNCTION sc031_reject_dispute_after_completion();

-- Recognize already settled historic periods without inventing an earlier
-- completion timestamp or pretending any person clicked a confirmation.
-- No original expenses, obligations, cash rows or snapshot state are updated.
INSERT INTO group_settlement_cycle_completions
  (cycle_id,group_id,origin,triggered_by)
SELECT cy.id,cy.group_id,'backfill',NULL
FROM group_settlement_cycles cy
WHERE cy.state='locked' AND cy.cancelled_at IS NULL
  AND sc031_cycle_ready(cy.group_id,cy.id)
ORDER BY cy.group_id,cy.id
ON CONFLICT(cycle_id) DO NOTHING;
