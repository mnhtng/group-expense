-- A bill is completed only after ALL active obligations are confirmed
-- and the ORIGINAL expense creator explicitly approves completion.
-- Settlement events remain immutable; completion is a separate audited event.
ALTER TABLE expenses
  ADD COLUMN completed_at timestamptz,
  ADD COLUMN completed_by text REFERENCES "user"(id) ON DELETE RESTRICT,
  ADD CONSTRAINT expense_completion_pair CHECK (
    (completed_at IS NULL AND completed_by IS NULL)
    OR (completed_at IS NOT NULL AND completed_by = created_by)
  );

ALTER TABLE expense_events DROP CONSTRAINT expense_events_operation_check;
ALTER TABLE expense_events
  ADD CONSTRAINT expense_events_operation_check
  CHECK(operation IN ('created','updated','deleted','completed'));

CREATE INDEX expenses_group_completed_idx
  ON expenses(group_id, completed_at DESC)
  WHERE deleted_at IS NULL AND completed_at IS NOT NULL;
