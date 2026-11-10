-- Creator-finalized invoices: append-only closure record, no destructive schema changes.
-- Original settlement allocations and approval history stay untouched.
ALTER TABLE expenses
  ADD COLUMN completed_at timestamptz,
  ADD COLUMN completed_by text REFERENCES "user"(id) ON DELETE RESTRICT,
  ADD CONSTRAINT expense_completion_pair CHECK (
    (completed_at IS NULL AND completed_by IS NULL)
    OR (completed_at IS NOT NULL AND completed_by = created_by)
  );

CREATE TABLE expense_completion_events (
  id uuid PRIMARY KEY,
  group_id uuid NOT NULL,
  expense_id uuid NOT NULL UNIQUE,
  actor_id text NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
  expense_version integer NOT NULL CHECK (expense_version > 0),
  note varchar(1000),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (expense_id,group_id) REFERENCES expenses(id,group_id) ON DELETE RESTRICT
);
CREATE INDEX expense_completion_events_group_idx
  ON expense_completion_events(group_id,recorded_at DESC);

CREATE INDEX expenses_group_completed_idx
  ON expenses(group_id, completed_at DESC)
  WHERE deleted_at IS NULL AND completed_at IS NOT NULL;
