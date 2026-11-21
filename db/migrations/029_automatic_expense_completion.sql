-- 029: system-attributed invoice completion after a fully confirmed payment or
-- an applied two-person noncash setoff. Retains original creator attribution
-- on expenses (legacy frozen-source and completion invariants depend on it).
-- The append-only event explicitly distinguishes system vs user confirmation.
-- This migration changes NO existing financial rows or ledger amounts.
ALTER TABLE expense_completion_events
  ALTER COLUMN actor_id DROP NOT NULL;

ALTER TABLE expense_completion_events
  ADD COLUMN origin text NOT NULL DEFAULT 'manual',
  ADD COLUMN triggered_by text REFERENCES "user"(id) ON DELETE RESTRICT,
  ADD CONSTRAINT expense_completion_origin_check CHECK (
    (origin='manual' AND actor_id IS NOT NULL AND triggered_by IS NULL) OR
    (origin='automatic' AND actor_id IS NULL AND triggered_by IS NOT NULL)
  );

COMMENT ON COLUMN expense_completion_events.origin IS
  'manual: original creator explicitly completed; automatic: system completed after confirmed settlement/setoff.';
COMMENT ON COLUMN expense_completion_events.triggered_by IS
  'For automatic completion only: real user whose confirmed financial action triggered the check. Not an invoice creator approval.';
COMMENT ON COLUMN expenses.completed_by IS
  'Legacy owner attribution: equals created_by. For actual action provenance consult expense_completion_events.origin/actor_id/triggered_by.';
