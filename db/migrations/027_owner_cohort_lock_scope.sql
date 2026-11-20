-- Owner-only group admission uses a separate least-privileged PostgreSQL role.
-- The SC-025 guard still acquires a group row lock before the rollout
-- advisory lock, but FOR SHARE is sufficient to block concurrent owner
-- transfers and does not require granting UPDATE on the groups table.
-- This changes no cohort, control, financial, or audit rows.
-- Explicit owner opt-out may leave global enabled with an empty cohort;
-- readEngineAccess continues to require BOTH enabled and admitted.
-- Existing global operator kill switch and 1/5/25 cohort caps remain.
CREATE OR REPLACE FUNCTION sc025_cohort_guard() RETURNS trigger LANGUAGE plpgsql AS $sc025$
DECLARE capacity integer; admitted_count integer; rollout_enabled boolean;
BEGIN
  IF TG_OP='UPDATE' AND (NEW.group_id<>OLD.group_id OR NEW.created_at<>OLD.created_at) THEN
    RAISE EXCEPTION 'Rollout membership identity is immutable';
  END IF;
  -- Same lock order as financial writes: group, then rollout control.
  PERFORM 1 FROM groups WHERE id=NEW.group_id AND (NOT NEW.admitted OR archived_at IS NULL)
    FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Rollout requires an active group'; END IF;
  PERFORM pg_advisory_xact_lock(250025,1);
  SELECT cohort_limit,enabled INTO capacity,rollout_enabled
    FROM settlement_cycle_engine_control WHERE id=1;
  IF NOT FOUND THEN RAISE EXCEPTION 'Rollout control missing'; END IF;
  SELECT count(*) INTO admitted_count FROM settlement_cycle_engine_cohort
    WHERE admitted AND group_id<>NEW.group_id;
  IF NEW.admitted AND admitted_count>=capacity THEN
    RAISE EXCEPTION 'Rollout cohort capacity exceeded';
  END IF;
  -- Owner can revoke the last group's admission even when global control
  -- remains enabled. Zero admitted groups implies zero eligible money writes.
  -- The operator-only control remains an independent emergency stop.
  NEW.updated_at:=clock_timestamp();
  RETURN NEW;
END $sc025$;
