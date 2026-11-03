-- Sprint 5: durable in-app notifications and encrypted Web Push subscriptions.
-- Do not store push endpoint keys in logs or expose them to other users.
CREATE TABLE notifications (
  id uuid PRIMARY KEY,
  recipient_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  actor_id text NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
  group_id uuid NOT NULL REFERENCES groups(id) ON DELETE RESTRICT,
  settlement_id uuid NOT NULL REFERENCES settlements(id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK (kind IN (
    'settlement_requested','settlement_confirmed',
    'settlement_rejected','settlement_cancelled'
  )),
  title varchar(160) NOT NULL,
  body varchar(500) NOT NULL,
  href varchar(300) NOT NULL CHECK (href LIKE '/groups/%'),
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notifications_not_self CHECK (recipient_id <> actor_id),
  CONSTRAINT notifications_one_event UNIQUE (recipient_id, settlement_id, kind)
);
CREATE INDEX notifications_recipient_recent_idx
  ON notifications (recipient_id, created_at DESC, id DESC);
CREATE INDEX notifications_unread_idx
  ON notifications (recipient_id, created_at DESC) WHERE read_at IS NULL;

CREATE TABLE push_subscriptions (
  id uuid PRIMARY KEY,
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  endpoint text NOT NULL UNIQUE CHECK (length(endpoint) BETWEEN 25 AND 2048),
  p256dh text NOT NULL,
  auth text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX push_subscriptions_user_idx ON push_subscriptions(user_id);

CREATE TABLE notification_preferences (
  user_id text PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  push_enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE notification_push_jobs (
  notification_id uuid NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  subscription_id uuid NOT NULL REFERENCES push_subscriptions(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','sending','sent','dead')),
  attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 20),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_until timestamptz,
  last_error text,
  sent_at timestamptz,
  PRIMARY KEY(notification_id, subscription_id)
);
CREATE INDEX notification_push_jobs_due_idx
  ON notification_push_jobs (next_attempt_at)
  WHERE status IN ('pending','sending');
