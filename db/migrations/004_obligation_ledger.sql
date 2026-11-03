-- Sprint 3: immutable-by-version obligation ledger with item-level source snapshots.
-- Netting and settlement allocations are intentionally deferred to Sprint 4.
CREATE TABLE obligations (
  id uuid PRIMARY KEY,
  group_id uuid NOT NULL,
  expense_id uuid NOT NULL,
  expense_version integer NOT NULL CHECK (expense_version > 0),
  debtor_id text NOT NULL,
  creditor_id text NOT NULL,
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  voided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT obligations_no_self_debt CHECK (debtor_id <> creditor_id),
  CONSTRAINT obligations_expense_fk FOREIGN KEY (expense_id, group_id)
    REFERENCES expenses(id, group_id) ON DELETE RESTRICT,
  CONSTRAINT obligations_debtor_fk FOREIGN KEY (group_id, debtor_id)
    REFERENCES group_members(group_id, user_id) ON DELETE RESTRICT,
  CONSTRAINT obligations_creditor_fk FOREIGN KEY (group_id, creditor_id)
    REFERENCES group_members(group_id, user_id) ON DELETE RESTRICT,
  CONSTRAINT obligations_version_person_unique UNIQUE (expense_id, expense_version, debtor_id, creditor_id)
);
CREATE UNIQUE INDEX obligations_one_active_pair_expense_idx
  ON obligations(expense_id, debtor_id, creditor_id) WHERE voided_at IS NULL;
CREATE INDEX obligations_debtor_current_idx ON obligations(debtor_id, group_id)
  WHERE voided_at IS NULL;
CREATE INDEX obligations_creditor_current_idx ON obligations(creditor_id, group_id)
  WHERE voided_at IS NULL;
CREATE INDEX obligations_group_current_idx ON obligations(group_id, expense_id)
  WHERE voided_at IS NULL;

-- Do not FK to mutable expense_items: editing an expense replaces item IDs.
-- These are permanent, queryable source snapshots for each obligation revision.
CREATE TABLE obligation_sources (
  id uuid PRIMARY KEY,
  obligation_id uuid NOT NULL REFERENCES obligations(id) ON DELETE RESTRICT,
  expense_item_id uuid NOT NULL,
  item_name varchar(160) NOT NULL CHECK (length(btrim(item_name)) > 0),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  CONSTRAINT obligation_sources_unique UNIQUE (obligation_id, expense_item_id)
);
CREATE INDEX obligation_sources_obligation_idx ON obligation_sources(obligation_id);

-- Backfill ACTIVE Sprint-2 expenses, including receipts entered before Sprint 3.
-- Exclude payer's own share and zero-value manual shares.
INSERT INTO obligations
  (id, group_id, expense_id, expense_version, debtor_id, creditor_id, amount_minor)
SELECT gen_random_uuid(), e.group_id, e.id, e.version, s.user_id, e.payer_id,
       sum(s.amount_minor)::bigint
FROM expenses e
JOIN expense_items i ON i.expense_id = e.id
JOIN expense_item_shares s ON s.item_id = i.id
WHERE e.deleted_at IS NULL AND s.user_id <> e.payer_id AND s.amount_minor > 0
GROUP BY e.group_id, e.id, e.version, e.payer_id, s.user_id;

INSERT INTO obligation_sources (id, obligation_id, expense_item_id, item_name, amount_minor)
SELECT gen_random_uuid(), o.id, i.id, i.name, s.amount_minor
FROM obligations o
JOIN expense_items i ON i.expense_id = o.expense_id
JOIN expense_item_shares s ON s.item_id = i.id AND s.user_id = o.debtor_id
WHERE o.voided_at IS NULL AND s.amount_minor > 0;
