CREATE TABLE groups (
  id uuid PRIMARY KEY,
  owner_id text NOT NULL REFERENCES "user"("id") ON DELETE RESTRICT,
  name varchar(120) NOT NULL CHECK (length(btrim(name)) >= 2),
  currency varchar(3) NOT NULL DEFAULT 'VND' CHECK (currency = 'VND'),
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE group_members (
  group_id uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES "user"("id") ON DELETE RESTRICT,
  role text NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, user_id)
);
CREATE INDEX group_members_user_idx ON group_members(user_id);

CREATE TABLE group_invites (
  id uuid PRIMARY KEY,
  group_id uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  token_hash char(64) NOT NULL UNIQUE,
  created_by text NOT NULL REFERENCES "user"("id") ON DELETE RESTRICT,
  expires_at timestamptz NOT NULL,
  max_uses integer NOT NULL DEFAULT 20 CHECK (max_uses BETWEEN 1 AND 100),
  uses_count integer NOT NULL DEFAULT 0 CHECK (uses_count >= 0 AND uses_count <= max_uses),
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX group_invites_group_idx ON group_invites(group_id);
