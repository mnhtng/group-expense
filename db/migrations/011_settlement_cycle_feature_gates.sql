-- SC-001: configuration only. NO obligations, cash settlements or set-off ledger changes.
-- Missing settings row means disabled for every legacy/new group.
-- This migration alone does not activate the settlement engine.
CREATE TABLE group_settlement_settings (
  group_id uuid PRIMARY KEY REFERENCES groups(id) ON DELETE RESTRICT,
  requested_enabled boolean NOT NULL DEFAULT false,
  requested_bilateral_netting boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 1 CHECK(version > 0),
  updated_by text NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT group_settlement_settings_netting_requires_cycle
    CHECK (NOT requested_bilateral_netting OR requested_enabled)
);

-- Historical grants are retained. Only one ACTIVE grant per member/group.
CREATE TABLE group_settlement_manager_grants (
  id uuid PRIMARY KEY,
  group_id uuid NOT NULL,
  user_id text NOT NULL,
  granted_by text NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_by text REFERENCES "user"(id) ON DELETE RESTRICT,
  revoked_at timestamptz,
  CONSTRAINT group_settlement_grant_revocation_consistency CHECK(
    (revoked_at IS NULL AND revoked_by IS NULL)
    OR (revoked_at IS NOT NULL AND revoked_by IS NOT NULL)
  ),
  FOREIGN KEY(group_id,user_id) REFERENCES group_members(group_id,user_id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX group_settlement_one_active_manager
  ON group_settlement_manager_grants(group_id,user_id)
  WHERE revoked_at IS NULL;
CREATE INDEX group_settlement_grants_group_history
  ON group_settlement_manager_grants(group_id,granted_at DESC);

-- Append-only policy audit; every change is attributed to a signed-in actor.
CREATE TABLE group_settlement_config_events (
  id uuid PRIMARY KEY,
  group_id uuid NOT NULL REFERENCES groups(id) ON DELETE RESTRICT,
  actor_id text NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
  subject_user_id text REFERENCES "user"(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK(event_type IN
    ('settings_changed','manager_granted','manager_revoked')),
  details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(details)='object'),
  recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX group_settlement_config_events_by_group
  ON group_settlement_config_events(group_id,recorded_at DESC);
