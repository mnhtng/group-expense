-- Sprint 4: two-party payment confirmation with per-obligation reservations.
-- A reported payment is not recognized against the debt until the OTHER party confirms.
CREATE TABLE settlements (
  id uuid PRIMARY KEY,
  group_id uuid NOT NULL REFERENCES groups(id) ON DELETE RESTRICT,
  debtor_id text NOT NULL,
  creditor_id text NOT NULL,
  initiated_by text NOT NULL REFERENCES "user"("id") ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'confirmed', 'rejected', 'cancelled')),
  amount_minor bigint NOT NULL CHECK(amount_minor > 0),
  request_key uuid NOT NULL,
  request_fingerprint char(64) NOT NULL,
  note varchar(500),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by text REFERENCES "user"("id") ON DELETE RESTRICT,
  CHECK (debtor_id <> creditor_id),
  CHECK (initiated_by IN (debtor_id, creditor_id)),
  CHECK ((status = 'pending' AND resolved_at IS NULL AND resolved_by IS NULL)
      OR (status <> 'pending' AND resolved_at IS NOT NULL AND resolved_by IS NOT NULL)),
  CHECK (resolved_by IS NULL OR resolved_by IN (debtor_id, creditor_id)),
  FOREIGN KEY (group_id, debtor_id) REFERENCES group_members(group_id, user_id) ON DELETE RESTRICT,
  FOREIGN KEY (group_id, creditor_id) REFERENCES group_members(group_id, user_id) ON DELETE RESTRICT,
  UNIQUE (group_id, initiated_by, request_key),
  UNIQUE (id, group_id, debtor_id, creditor_id)
);
CREATE INDEX settlements_pair_status_idx ON settlements(group_id, debtor_id, creditor_id, status);
CREATE INDEX settlements_initiator_idx ON settlements(initiated_by, created_at DESC);
CREATE INDEX settlements_pending_created_idx ON settlements(group_id, created_at DESC)
  WHERE status='pending';

-- Record precise source allocations; composite foreign keys prevent cross-group
-- and cross-debtor payments even if callers bypass application validation.
CREATE TABLE settlement_allocations (
  settlement_id uuid NOT NULL,
  obligation_id uuid NOT NULL,
  group_id uuid NOT NULL,
  debtor_id text NOT NULL,
  creditor_id text NOT NULL,
  amount_minor bigint NOT NULL CHECK(amount_minor > 0),
  PRIMARY KEY (settlement_id, obligation_id),
  FOREIGN KEY (settlement_id, group_id, debtor_id, creditor_id)
    REFERENCES settlements(id, group_id, debtor_id, creditor_id) ON DELETE RESTRICT,
  FOREIGN KEY (obligation_id, group_id, debtor_id, creditor_id)
    REFERENCES obligations(id, group_id, debtor_id, creditor_id) ON DELETE RESTRICT
);
CREATE INDEX settlement_allocations_obligation_idx ON settlement_allocations(obligation_id);

-- Append-only transitions. There is no event edit/delete operation in the app.
CREATE TABLE settlement_events (
  id uuid PRIMARY KEY,
  settlement_id uuid NOT NULL REFERENCES settlements(id) ON DELETE RESTRICT,
  actor_id text NOT NULL REFERENCES "user"("id") ON DELETE RESTRICT,
  event_type text NOT NULL CHECK(event_type IN ('created','confirmed','rejected','cancelled')),
  note varchar(500),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (settlement_id, event_type)
);
CREATE INDEX settlement_events_history_idx ON settlement_events(settlement_id, recorded_at);
