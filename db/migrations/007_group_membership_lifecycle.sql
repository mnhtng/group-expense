-- Keep membership rows and historical financial foreign keys forever.
-- Only active memberships can manage groups or participate in new expenses.
ALTER TABLE group_members
  ADD COLUMN status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','left','removed')),
  ADD COLUMN left_at timestamptz,
  ADD COLUMN removed_by text REFERENCES "user"(id) ON DELETE RESTRICT,
  ADD COLUMN rejoined_at timestamptz,
  ADD CONSTRAINT group_members_departure_consistent CHECK (
    (status='active' AND left_at IS NULL AND removed_by IS NULL)
    OR (status='left' AND left_at IS NOT NULL AND removed_by IS NULL)
    OR (status='removed' AND left_at IS NOT NULL AND removed_by IS NOT NULL)
  );

-- Only one active owner membership for a group.
CREATE UNIQUE INDEX group_members_one_active_owner
 ON group_members(group_id) WHERE role='owner' AND status='active';
CREATE INDEX group_members_active_user_idx
 ON group_members(user_id,group_id) WHERE status='active';

CREATE TABLE group_membership_events (
 id uuid PRIMARY KEY,
 group_id uuid NOT NULL REFERENCES groups(id) ON DELETE RESTRICT,
 user_id text NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
 actor_id text NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
 kind text NOT NULL CHECK(kind IN ('left','removed','rejoined','ownership_transferred')),
 details jsonb NOT NULL DEFAULT '{}'::jsonb,
 recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX group_membership_events_group_idx
 ON group_membership_events(group_id,recorded_at DESC);
