-- Reviewed operator-controlled rollout. A migration never enrolls a group.
-- Runtime gets SELECT only; group opt-in remains a separate requirement.
CREATE TABLE settlement_cycle_engine_control (
  id smallint PRIMARY KEY CHECK(id=1),
  enabled boolean NOT NULL DEFAULT false,
  cohort_limit smallint NOT NULL DEFAULT 1 CHECK(cohort_limit IN(1,5,25)),
  revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO settlement_cycle_engine_control(id) VALUES(1);

CREATE TABLE settlement_cycle_engine_cohort (
  group_id uuid PRIMARY KEY REFERENCES groups(id) ON DELETE RESTRICT,
  admitted boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE settlement_cycle_engine_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  subject text NOT NULL CHECK(subject IN('control','cohort')),
  group_id uuid REFERENCES groups(id) ON DELETE RESTRICT,
  operator_role text NOT NULL DEFAULT current_user,
  before_state jsonb,
  after_state jsonb NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CHECK((subject='control' AND group_id IS NULL) OR
        (subject='cohort' AND group_id IS NOT NULL))
);

CREATE FUNCTION sc025_control_guard() RETURNS trigger LANGUAGE plpgsql AS $sc025$
DECLARE admitted_count integer;
BEGIN
  PERFORM pg_advisory_xact_lock(250025,1);
  IF NEW.id<>OLD.id THEN RAISE EXCEPTION 'Rollout identity is immutable'; END IF;
  SELECT count(*) INTO admitted_count FROM settlement_cycle_engine_cohort WHERE admitted;
  IF admitted_count>NEW.cohort_limit THEN
    RAISE EXCEPTION 'Rollout limit cannot exclude admitted groups';
  END IF;
  IF NEW.enabled AND admitted_count=0 THEN
    RAISE EXCEPTION 'Cannot enable an empty rollout';
  END IF;
  NEW.revision:=OLD.revision+1;
  NEW.updated_at:=clock_timestamp();
  RETURN NEW;
END $sc025$;
CREATE TRIGGER sc025_control_guard BEFORE UPDATE ON settlement_cycle_engine_control
  FOR EACH ROW EXECUTE FUNCTION sc025_control_guard();

CREATE FUNCTION sc025_cohort_guard() RETURNS trigger LANGUAGE plpgsql AS $sc025$
DECLARE capacity integer; admitted_count integer; rollout_enabled boolean;
BEGIN
  IF TG_OP='UPDATE' AND (NEW.group_id<>OLD.group_id OR NEW.created_at<>OLD.created_at) THEN
    RAISE EXCEPTION 'Rollout membership identity is immutable';
  END IF;
  -- Same lock order as financial writes: group, then rollout control.
  PERFORM 1 FROM groups WHERE id=NEW.group_id AND (NOT NEW.admitted OR archived_at IS NULL)
    FOR UPDATE;
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
  IF NOT NEW.admitted AND admitted_count=0 AND rollout_enabled THEN
    RAISE EXCEPTION 'Pause rollout before removing the final group';
  END IF;
  NEW.updated_at:=clock_timestamp();
  RETURN NEW;
END $sc025$;
CREATE TRIGGER sc025_cohort_guard BEFORE INSERT OR UPDATE ON settlement_cycle_engine_cohort
  FOR EACH ROW EXECUTE FUNCTION sc025_cohort_guard();

CREATE FUNCTION sc025_rollout_audit() RETURNS trigger LANGUAGE plpgsql AS $sc025$
BEGIN
  INSERT INTO settlement_cycle_engine_events(subject,group_id,before_state,after_state)
  VALUES(CASE WHEN TG_TABLE_NAME='settlement_cycle_engine_control' THEN 'control' ELSE 'cohort' END,
    CASE WHEN TG_TABLE_NAME='settlement_cycle_engine_cohort' THEN (to_jsonb(NEW)->>'group_id')::uuid ELSE NULL END,
    CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD) ELSE NULL END,to_jsonb(NEW));
  RETURN NEW;
END $sc025$;
CREATE TRIGGER sc025_control_audit AFTER UPDATE ON settlement_cycle_engine_control
  FOR EACH ROW EXECUTE FUNCTION sc025_rollout_audit();
CREATE TRIGGER sc025_cohort_audit AFTER INSERT OR UPDATE ON settlement_cycle_engine_cohort
  FOR EACH ROW EXECUTE FUNCTION sc025_rollout_audit();

CREATE TRIGGER sc025_events_immutable BEFORE UPDATE OR DELETE ON settlement_cycle_engine_events
  FOR EACH ROW EXECUTE FUNCTION rr004_immutable_legacy_audit();
CREATE TRIGGER sc025_events_no_truncate BEFORE TRUNCATE ON settlement_cycle_engine_events
  FOR EACH STATEMENT EXECUTE FUNCTION rr004_immutable_legacy_audit();
CREATE TRIGGER sc025_control_no_delete BEFORE DELETE ON settlement_cycle_engine_control
  FOR EACH ROW EXECUTE FUNCTION rr004_immutable_legacy_audit();
CREATE TRIGGER sc025_control_no_truncate BEFORE TRUNCATE ON settlement_cycle_engine_control
  FOR EACH STATEMENT EXECUTE FUNCTION rr004_immutable_legacy_audit();
CREATE TRIGGER sc025_cohort_no_delete BEFORE DELETE ON settlement_cycle_engine_cohort
  FOR EACH ROW EXECUTE FUNCTION rr004_immutable_legacy_audit();
CREATE TRIGGER sc025_cohort_no_truncate BEFORE TRUNCATE ON settlement_cycle_engine_cohort
  FOR EACH STATEMENT EXECUTE FUNCTION rr004_immutable_legacy_audit();
