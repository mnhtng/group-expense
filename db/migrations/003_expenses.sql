-- Sprint 2: itemized VND expense records; monetary fields use integer dong.
-- Do not modify applied migrations. Sprint 3 obligations will refer to these item shares.
CREATE TABLE expenses (
  id uuid PRIMARY KEY,
  group_id uuid NOT NULL REFERENCES groups(id) ON DELETE RESTRICT,
  payer_id text NOT NULL,
  created_by text NOT NULL REFERENCES "user"("id") ON DELETE RESTRICT,
  title varchar(160) NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 160),
  notes varchar(1000),
  occurred_on date NOT NULL DEFAULT CURRENT_DATE,
  total_minor bigint NOT NULL CHECK (total_minor > 0),
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, group_id),
  FOREIGN KEY (group_id, payer_id)
    REFERENCES group_members(group_id, user_id) ON DELETE RESTRICT
);
CREATE INDEX expenses_group_date_idx ON expenses(group_id, occurred_on DESC, created_at DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX expenses_payer_idx ON expenses(payer_id) WHERE deleted_at IS NULL;

CREATE TABLE expense_items (
  id uuid PRIMARY KEY,
  expense_id uuid NOT NULL,
  group_id uuid NOT NULL,
  position integer NOT NULL CHECK(position >= 0),
  name varchar(160) NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 160),
  quantity integer NOT NULL CHECK(quantity BETWEEN 1 AND 9999),
  unit_price_minor bigint NOT NULL CHECK(unit_price_minor > 0),
  amount_minor bigint NOT NULL CHECK(amount_minor > 0 AND amount_minor = quantity * unit_price_minor),
  UNIQUE (expense_id, position),
  UNIQUE (id, group_id),
  FOREIGN KEY (expense_id, group_id)
    REFERENCES expenses(id, group_id) ON DELETE CASCADE
);
CREATE INDEX expense_items_expense_idx ON expense_items(expense_id, position);

CREATE TABLE expense_item_shares (
  item_id uuid NOT NULL,
  group_id uuid NOT NULL,
  user_id text NOT NULL,
  amount_minor bigint NOT NULL CHECK(amount_minor >= 0),
  PRIMARY KEY(item_id, user_id),
  FOREIGN KEY(item_id, group_id) REFERENCES expense_items(id, group_id) ON DELETE CASCADE,
  FOREIGN KEY(group_id, user_id) REFERENCES group_members(group_id, user_id) ON DELETE RESTRICT
);
CREATE INDEX expense_item_shares_user_idx ON expense_item_shares(user_id);

-- Changes are recorded before edits; revisions can be audited later.
CREATE TABLE expense_events (
  id uuid PRIMARY KEY,
  group_id uuid NOT NULL REFERENCES groups(id) ON DELETE RESTRICT,
  expense_id uuid NOT NULL REFERENCES expenses(id) ON DELETE RESTRICT,
  actor_id text NOT NULL REFERENCES "user"("id") ON DELETE RESTRICT,
  operation text NOT NULL CHECK(operation IN ('created','updated','deleted')),
  version integer NOT NULL CHECK(version >= 1),
  snapshot jsonb NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (expense_id, version)
);
CREATE INDEX expense_events_expense_idx ON expense_events(expense_id, recorded_at);
