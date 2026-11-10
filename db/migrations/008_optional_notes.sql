-- Optional contextual notes for all group workflows. Applied after 007.
-- Existing rows stay valid; no destructive data changes.
ALTER TABLE groups ADD COLUMN notes varchar(1000);
ALTER TABLE group_invites ADD COLUMN notes varchar(1000);

-- Audit operations with notes that do not belong to the mutable group description.
CREATE TABLE group_note_events (
  id uuid PRIMARY KEY,
  group_id uuid NOT NULL REFERENCES groups(id) ON DELETE RESTRICT,
  actor_id text NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (event_type IN
    ('created','updated','archived','invite_created','invite_accepted')),
  note varchar(1000),
  recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX group_note_events_group_idx
  ON group_note_events(group_id, recorded_at DESC);
