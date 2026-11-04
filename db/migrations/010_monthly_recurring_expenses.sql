-- Fixed monthly expense templates. SQL-only, no ORM.
-- A generated invoice is a normal immutable-by-version expense/obligation.
CREATE TABLE recurring_expense_rules (
  id uuid PRIMARY KEY,
  group_id uuid NOT NULL REFERENCES groups(id) ON DELETE RESTRICT,
  created_by text NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
  payer_id text NOT NULL,
  title varchar(160) NOT NULL CHECK(length(btrim(title)) BETWEEN 1 AND 160),
  notes varchar(1000) NOT NULL DEFAULT '',
  day_of_month smallint NOT NULL CHECK(day_of_month BETWEEN 1 AND 31),
  starts_on date NOT NULL,
  items jsonb NOT NULL CHECK(jsonb_typeof(items)='array'),
  total_minor bigint NOT NULL CHECK(total_minor > 0),
  status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','paused')),
  version integer NOT NULL DEFAULT 1 CHECK(version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(id,group_id),
  FOREIGN KEY(group_id,payer_id) REFERENCES group_members(group_id,user_id) ON DELETE RESTRICT
);

CREATE INDEX recurring_rules_group_idx
  ON recurring_expense_rules(group_id,status,created_at DESC);
CREATE INDEX recurring_rules_active_idx
  ON recurring_expense_rules(created_at,id) WHERE status='active';

CREATE TABLE recurring_expense_occurrences (
  id uuid PRIMARY KEY,
  rule_id uuid NOT NULL,
  group_id uuid NOT NULL,
  period date NOT NULL CHECK (EXTRACT(DAY FROM period)=1),
  scheduled_on date NOT NULL,
  expense_id uuid NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(rule_id,period),
  FOREIGN KEY(rule_id,group_id) REFERENCES recurring_expense_rules(id,group_id) ON DELETE RESTRICT,
  FOREIGN KEY(expense_id,group_id) REFERENCES expenses(id,group_id) ON DELETE RESTRICT
);
CREATE INDEX recurring_occurrences_group_idx
  ON recurring_expense_occurrences(group_id,scheduled_on DESC);
CREATE INDEX recurring_occurrences_rule_idx
  ON recurring_expense_occurrences(rule_id,period DESC);

-- Keep completion/audit and existing invoices unchanged.
