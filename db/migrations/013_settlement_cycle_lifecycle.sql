-- SC-003: metadata-only cycle lifecycle. No obligation, cash or set-off changes.
-- Cycles are immutable, non-overlapping [start_at,end_at) instants in UTC.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Composite FK binds each cycle to a revision belonging to the SAME group.
CREATE UNIQUE INDEX settlement_schedule_revision_group_identity
  ON group_settlement_schedule_revisions(id,group_id);

CREATE TABLE group_settlement_cycles (
  id uuid PRIMARY KEY,
  group_id uuid NOT NULL REFERENCES groups(id) ON DELETE RESTRICT,
  schedule_revision_id uuid NOT NULL,
  source text NOT NULL CHECK (source IN ('scheduled','manual')),
  period_start date NOT NULL,
  period_end date NOT NULL,
  time_zone varchar(64) NOT NULL,
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL,
  state text NOT NULL DEFAULT 'open' CHECK(state IN ('open','review')),
  version integer NOT NULL DEFAULT 1 CHECK(version > 0),
  reviewed_at timestamptz,
  created_by text REFERENCES "user"(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cycle_dates_ordered CHECK(period_start < period_end),
  CONSTRAINT cycle_instants_ordered CHECK(start_at < end_at),
  CONSTRAINT cycle_review_consistent CHECK(
    (state='open' AND reviewed_at IS NULL)
    OR (state='review' AND reviewed_at IS NOT NULL)
  ),
  CONSTRAINT cycle_source_actor_consistent CHECK (
    (source='scheduled' AND created_by IS NULL)
    OR (source='manual' AND created_by IS NOT NULL)
  ),
  CONSTRAINT cycle_schedule_group_fk FOREIGN KEY(schedule_revision_id,group_id)
    REFERENCES group_settlement_schedule_revisions(id,group_id) ON DELETE RESTRICT,
  CONSTRAINT cycle_identity_group UNIQUE(id,group_id),
  CONSTRAINT cycle_revision_start UNIQUE(schedule_revision_id,period_start),
  -- An exclusion constraint prevents overlapping periods even if code has
  -- a race, is bypassed or revisions have different frequencies/timezones.
  CONSTRAINT cycle_group_no_overlap EXCLUDE USING gist
    (group_id WITH =, tstzrange(start_at,end_at,'[)') WITH &&)
);
CREATE INDEX settlement_cycles_by_group_state
  ON group_settlement_cycles(group_id,state,start_at DESC);
CREATE INDEX settlement_cycles_due_for_review
  ON group_settlement_cycles(end_at)
  WHERE state='open';
CREATE INDEX settlement_cycles_revision_progress
  ON group_settlement_cycles(schedule_revision_id,period_end DESC)
  WHERE source='scheduled';

CREATE TABLE group_settlement_cycle_events (
  id uuid PRIMARY KEY,
  group_id uuid NOT NULL,
  cycle_id uuid NOT NULL,
  event_type text NOT NULL CHECK(event_type IN ('created','review_requested')),
  initiator text NOT NULL CHECK(initiator IN ('member','cron')),
  actor_id text REFERENCES "user"(id) ON DELETE RESTRICT,
  from_state text,
  to_state text NOT NULL CHECK(to_state IN ('open','review')),
  cycle_version integer NOT NULL CHECK(cycle_version>0),
  details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(details)='object'),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT cycle_event_actor_consistent CHECK (
    (initiator='member' AND actor_id IS NOT NULL)
    OR (initiator='cron' AND actor_id IS NULL)
  ),
  CONSTRAINT cycle_event_transition_consistent CHECK (
    (event_type='created' AND from_state IS NULL AND to_state='open' AND cycle_version=1)
    OR (event_type='review_requested' AND from_state='open' AND to_state='review' AND cycle_version=2)
  ),
  CONSTRAINT cycle_event_group_fk FOREIGN KEY(cycle_id,group_id)
    REFERENCES group_settlement_cycles(id,group_id) ON DELETE RESTRICT,
  CONSTRAINT cycle_event_unique_transition UNIQUE(cycle_id,cycle_version)
);
CREATE INDEX settlement_cycle_events_by_group
  ON group_settlement_cycle_events(group_id,recorded_at DESC);

-- Do not allow deleting cycles or mutating their identity/calendar boundaries.
-- The only transition available until SC-004 is OPEN -> REVIEW after end_at.
CREATE FUNCTION sc003_guard_cycle() RETURNS trigger LANGUAGE plpgsql AS $sc003$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'Settlement cycles cannot be deleted';
  END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.state<>'open' OR NEW.version<>1 OR NEW.reviewed_at IS NOT NULL THEN
      RAISE EXCEPTION 'Cycle must be created OPEN at version 1';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.state<>'open' OR NEW.state<>'review'
     OR OLD.reviewed_at IS NOT NULL OR NEW.reviewed_at IS NULL
     OR NEW.reviewed_at < OLD.end_at
     OR NEW.version<>OLD.version+1
     OR (to_jsonb(NEW) - 'state' - 'version' - 'reviewed_at' - 'updated_at')
         <> (to_jsonb(OLD) - 'state' - 'version' - 'reviewed_at' - 'updated_at')
  THEN
    RAISE EXCEPTION 'Only OPEN to REVIEW is allowed, without changing the cycle identity';
  END IF;
  RETURN NEW;
END;
$sc003$;
CREATE TRIGGER sc003_cycle_immutability
  BEFORE INSERT OR UPDATE OR DELETE ON group_settlement_cycles
  FOR EACH ROW EXECUTE FUNCTION sc003_guard_cycle();

-- Every created/reviewed lifecycle event is immutable and unique per version.
CREATE FUNCTION sc003_guard_event() RETURNS trigger LANGUAGE plpgsql AS $sc003$
BEGIN
  RAISE EXCEPTION 'Settlement cycle events are append-only';
END;
$sc003$;
CREATE TRIGGER sc003_cycle_event_immutability
  BEFORE UPDATE OR DELETE ON group_settlement_cycle_events
  FOR EACH ROW EXECUTE FUNCTION sc003_guard_event();

-- Deliberately no financial ledger DDL, snapshot tables or set-off tables.
