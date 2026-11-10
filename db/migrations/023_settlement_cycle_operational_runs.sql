-- SC-010: durable operational evidence only, no financial schema/ledger changes.
-- A run starts as "running", can transition exactly once to a terminal
-- status, and then becomes immutable. Failed/interrupted runs survive.
CREATE TABLE settlement_cycle_operational_runs (
  id uuid PRIMARY KEY,
  mode text NOT NULL CHECK (mode IN ('scheduled','manual-replay')),
  status text NOT NULL DEFAULT 'running'
    CHECK (status IN ('running','success','partial','failed')),
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz,
  stage_results jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(stage_results)='object'),
  CONSTRAINT sc010_run_terminal_consistency CHECK (
    (status='running' AND completed_at IS NULL)
    OR (status IN ('success','partial','failed') AND completed_at IS NOT NULL)
  ),
  CONSTRAINT sc010_run_completion_order CHECK (
    completed_at IS NULL OR completed_at>=started_at
  )
);
CREATE INDEX sc010_runs_latest
  ON settlement_cycle_operational_runs(started_at DESC,id DESC);
CREATE INDEX sc010_runs_incomplete
  ON settlement_cycle_operational_runs(started_at)
  WHERE status='running';

CREATE FUNCTION sc010_guard_operational_run()
RETURNS trigger LANGUAGE plpgsql AS $sc010$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'SC-010 operational run history cannot be deleted';
  END IF;
  IF TG_OP='UPDATE' THEN
    IF OLD.status<>'running' THEN
      RAISE EXCEPTION 'SC-010 completed operational run is immutable';
    END IF;
    IF OLD.id IS DISTINCT FROM NEW.id
       OR OLD.mode IS DISTINCT FROM NEW.mode
       OR OLD.started_at IS DISTINCT FROM NEW.started_at
       OR NEW.status NOT IN ('success','partial','failed')
       OR NEW.completed_at IS NULL
       OR jsonb_typeof(NEW.stage_results)<>'object'
    THEN
      RAISE EXCEPTION 'SC-010 invalid operational run completion';
    END IF;
  END IF;
  RETURN NEW;
END;$sc010$;
CREATE TRIGGER sc010_operational_history_guard
 BEFORE UPDATE OR DELETE ON settlement_cycle_operational_runs
 FOR EACH ROW EXECUTE FUNCTION sc010_guard_operational_run();

-- Only aggregated system counts; never persist credentials, member IDs,
-- invoice text, payee identities or mutable settlement state in this log.

-- SC-010: rotate active recurring rule scans; a fixed oldest-200 LIMIT
-- would starve newer templates forever when a group has >200 templates.
-- Checkpoints store only rule identity and scheduling diagnostics.
CREATE TABLE recurring_cron_checkpoints (
  rule_id uuid PRIMARY KEY REFERENCES recurring_expense_rules(id)
    ON DELETE CASCADE,
  last_checked_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  last_error_at timestamptz
);
CREATE INDEX sc010_recurring_checked
  ON recurring_cron_checkpoints(last_checked_at,rule_id);
