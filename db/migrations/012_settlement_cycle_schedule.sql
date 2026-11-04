-- SC-002: versioned, future-only settlement schedule configuration.
-- This schema cannot generate cycles, allocate money or enable the engine.
CREATE TABLE group_settlement_schedule_heads (
  group_id uuid PRIMARY KEY REFERENCES groups(id) ON DELETE RESTRICT,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_by text NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- History is append-only except for marking an UNACTIVATED future revision
-- as superseded. Active/historical revisions must never be changed.
CREATE TABLE group_settlement_schedule_revisions (
  id uuid PRIMARY KEY,
  group_id uuid NOT NULL REFERENCES group_settlement_schedule_heads(group_id) ON DELETE RESTRICT,
  version integer NOT NULL CHECK (version > 0),
  frequency text NOT NULL CHECK (frequency IN ('weekly','biweekly','monthly','manual')),
  time_zone text NOT NULL CHECK (length(time_zone) BETWEEN 1 AND 64),
  anchor_date date NOT NULL,
  effective_at timestamptz NOT NULL,
  created_by text NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  superseded_at timestamptz,
  CONSTRAINT settlement_schedule_unique_version UNIQUE (group_id,version)
);
CREATE INDEX group_settlement_schedule_active
  ON group_settlement_schedule_revisions(group_id,effective_at DESC)
  WHERE superseded_at IS NULL;
CREATE UNIQUE INDEX group_settlement_schedule_one_cutover
  ON group_settlement_schedule_revisions(group_id,effective_at)
  WHERE superseded_at IS NULL;

CREATE TABLE group_settlement_schedule_events (
  id uuid PRIMARY KEY,
  group_id uuid NOT NULL REFERENCES groups(id) ON DELETE RESTRICT,
  schedule_revision_id uuid NOT NULL REFERENCES group_settlement_schedule_revisions(id) ON DELETE RESTRICT,
  actor_id text NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (event_type IN ('schedule_created','schedule_replaced')),
  previous_revision_id uuid REFERENCES group_settlement_schedule_revisions(id) ON DELETE RESTRICT,
  details jsonb NOT NULL CHECK (jsonb_typeof(details)='object'),
  recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX group_settlement_schedule_event_history
  ON group_settlement_schedule_events(group_id,recorded_at DESC);

-- No touch to expenses, obligations, settlements, feature gate or production.
