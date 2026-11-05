-- BN-002: immutable, UNAPPROVED bilateral proposal documents only.
-- Neither these records nor switching a proposal head reserve or discharge debt.
-- Do not touch obligations, settlements, cash allocations or cycle status.

ALTER TABLE group_settlement_cycle_snapshot_obligations
 ADD CONSTRAINT bn002_snapshot_pair_identity
 UNIQUE(cycle_id,group_id,obligation_id,debtor_id,creditor_id);

CREATE TABLE group_settlement_bilateral_heads (
  group_id uuid NOT NULL,
  cycle_id uuid NOT NULL,
  party_low text COLLATE "C" NOT NULL,
  party_high text COLLATE "C" NOT NULL,
  version integer NOT NULL DEFAULT 0 CHECK(version >= 0),
  current_proposal_id uuid,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(group_id,cycle_id,party_low,party_high),
  FOREIGN KEY(cycle_id,group_id)
    REFERENCES group_settlement_cycle_snapshots(cycle_id,group_id) ON DELETE RESTRICT,
  FOREIGN KEY(group_id,party_low)
    REFERENCES group_members(group_id,user_id) ON DELETE RESTRICT,
  FOREIGN KEY(group_id,party_high)
    REFERENCES group_members(group_id,user_id) ON DELETE RESTRICT,
  CONSTRAINT bn002_distinct_ordered_pair CHECK(party_low < party_high),
  CONSTRAINT bn002_head_state CHECK(
    (version=0 AND current_proposal_id IS NULL)
    OR (version>0 AND current_proposal_id IS NOT NULL))
);

CREATE TABLE group_settlement_bilateral_proposals (
  id uuid PRIMARY KEY,
  group_id uuid NOT NULL,
  cycle_id uuid NOT NULL,
  party_low text COLLATE "C" NOT NULL,
  party_high text COLLATE "C" NOT NULL,
  version integer NOT NULL CHECK(version > 0),
  request_key uuid NOT NULL,
  request_digest char(64) NOT NULL CHECK(request_digest ~ '^[0-9a-f]{64}$'),
  source_fingerprint char(64) NOT NULL CHECK(source_fingerprint ~ '^[0-9a-f]{64}$'),
  snapshot_fingerprint char(64) NOT NULL CHECK(snapshot_fingerprint ~ '^[0-9a-f]{64}$'),
  created_by text NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
  currency text NOT NULL DEFAULT 'VND' CHECK(currency='VND'),
  offset_minor numeric(38,0) NOT NULL CHECK(offset_minor > 0),
  source_count integer NOT NULL CHECK(source_count >= 2),
  allocation_count integer NOT NULL CHECK(allocation_count >= 2),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY(group_id,cycle_id,party_low,party_high)
    REFERENCES group_settlement_bilateral_heads(group_id,cycle_id,party_low,party_high)
    ON DELETE RESTRICT,
  CONSTRAINT bn002_proposal_party CHECK(party_low < party_high AND created_by IN (party_low,party_high)),
  CONSTRAINT bn002_one_version UNIQUE(group_id,cycle_id,party_low,party_high,version),
  CONSTRAINT bn002_request_idempotent UNIQUE(group_id,created_by,request_key),
  CONSTRAINT bn002_proposal_scope_unique UNIQUE(id,group_id,cycle_id,party_low,party_high)
);
ALTER TABLE group_settlement_bilateral_heads
  ADD CONSTRAINT bn002_head_proposal_fk
  FOREIGN KEY(current_proposal_id,group_id,cycle_id,party_low,party_high)
  REFERENCES group_settlement_bilateral_proposals(id,group_id,cycle_id,party_low,party_high)
  ON DELETE RESTRICT;
CREATE INDEX bn002_proposal_pair_history
  ON group_settlement_bilateral_proposals(group_id,cycle_id,party_low,party_high,version DESC);

-- Complete source proof includes zero-available original obligations.
-- All columns are AS-OF proposal creation, never a reservation.
CREATE TABLE group_settlement_bilateral_sources (
  proposal_id uuid NOT NULL,
  group_id uuid NOT NULL,
  cycle_id uuid NOT NULL,
  party_low text COLLATE "C" NOT NULL,
  party_high text COLLATE "C" NOT NULL,
  obligation_id uuid NOT NULL,
  debtor_id text NOT NULL,
  creditor_id text NOT NULL,
  occurred_on date NOT NULL,
  expense_version integer NOT NULL CHECK(expense_version > 0),
  original_minor bigint NOT NULL CHECK(original_minor > 0),
  confirmed_cash_minor numeric(38,0) NOT NULL CHECK(confirmed_cash_minor >= 0),
  pending_cash_minor numeric(38,0) NOT NULL CHECK(pending_cash_minor >= 0),
  confirmed_setoff_minor numeric(38,0) NOT NULL DEFAULT 0 CHECK(confirmed_setoff_minor=0),
  pending_setoff_minor numeric(38,0) NOT NULL DEFAULT 0 CHECK(pending_setoff_minor=0),
  available_before_minor numeric(38,0) NOT NULL CHECK(available_before_minor >= 0),
  proposed_minor numeric(38,0) NOT NULL CHECK(proposed_minor >= 0),
  available_after_minor numeric(38,0) NOT NULL CHECK(available_after_minor >= 0),
  PRIMARY KEY(proposal_id,obligation_id),
  FOREIGN KEY(proposal_id,group_id,cycle_id,party_low,party_high)
    REFERENCES group_settlement_bilateral_proposals(id,group_id,cycle_id,party_low,party_high)
    ON DELETE RESTRICT,
  FOREIGN KEY(cycle_id,group_id,obligation_id,debtor_id,creditor_id)
    REFERENCES group_settlement_cycle_snapshot_obligations
    (cycle_id,group_id,obligation_id,debtor_id,creditor_id) ON DELETE RESTRICT,
  CONSTRAINT bn002_direction_only CHECK(
    (debtor_id=party_low AND creditor_id=party_high)
    OR (debtor_id=party_high AND creditor_id=party_low)),
  CONSTRAINT bn002_source_conservation CHECK(
    original_minor=confirmed_cash_minor+pending_cash_minor+available_before_minor
    AND available_before_minor=proposed_minor+available_after_minor)
);
CREATE INDEX bn002_source_by_obligation
  ON group_settlement_bilateral_sources(obligation_id,proposal_id);

-- Database-level append-only proposal source & document history, including
-- when a group is later disabled. Head alone is mutable and version guarded.
CREATE FUNCTION bn002_immutable_document() RETURNS trigger LANGUAGE plpgsql AS $bn002$
BEGIN RAISE EXCEPTION 'BN-002 proposal documents are immutable'; END;
$bn002$;
CREATE TRIGGER bn002_proposal_immutable
  BEFORE UPDATE OR DELETE ON group_settlement_bilateral_proposals
  FOR EACH ROW EXECUTE FUNCTION bn002_immutable_document();
CREATE TRIGGER bn002_sources_immutable
  BEFORE UPDATE OR DELETE ON group_settlement_bilateral_sources
  FOR EACH ROW EXECUTE FUNCTION bn002_immutable_document();

-- A proposal must be assembled only under its current head version.
-- No extra source rows may be appended once the head has advanced.
CREATE FUNCTION bn002_guard_source_insert() RETURNS trigger LANGUAGE plpgsql AS $bn002$
DECLARE p record; h record;
BEGIN
  SELECT * INTO p FROM group_settlement_bilateral_proposals
    WHERE id=NEW.proposal_id;
  SELECT * INTO h FROM group_settlement_bilateral_heads
    WHERE group_id=NEW.group_id AND cycle_id=NEW.cycle_id
      AND party_low=NEW.party_low AND party_high=NEW.party_high;
  IF p.id IS NULL OR h.group_id IS NULL OR
     h.version<>p.version-1 OR
     NEW.group_id<>p.group_id OR NEW.cycle_id<>p.cycle_id OR
     NOT EXISTS(
       SELECT 1 FROM group_settlement_cycle_snapshot_obligations src
       JOIN obligations o ON o.id=src.obligation_id
       JOIN expenses e ON e.id=o.expense_id
       JOIN group_settlement_cycle_snapshot_expenses se
         ON se.cycle_id=src.cycle_id AND se.expense_id=o.expense_id
       WHERE src.cycle_id=NEW.cycle_id AND src.group_id=NEW.group_id
         AND src.obligation_id=NEW.obligation_id
         AND src.debtor_id=NEW.debtor_id AND src.creditor_id=NEW.creditor_id
         AND o.voided_at IS NULL AND e.deleted_at IS NULL
         AND src.original_minor=NEW.original_minor
         AND src.expense_version=NEW.expense_version
         AND e.version=NEW.expense_version
         AND o.expense_version=NEW.expense_version
         AND e.occurred_on=NEW.occurred_on AND se.occurred_on=NEW.occurred_on
     ) THEN
    RAISE EXCEPTION 'BN-002 invalid proposal source or sealed version';
  END IF;
  RETURN NEW;
END;
$bn002$;
CREATE TRIGGER bn002_sources_insert_guard
  BEFORE INSERT ON group_settlement_bilateral_sources
  FOR EACH ROW EXECUTE FUNCTION bn002_guard_source_insert();

-- Head switch is the sole publication operation. The trigger requires the
-- complete ORIGINAL pair source set, exact directional balance conservation,
-- live confirmed/pending cash, original source version, and immutable
-- manifest identity. No approval status exists and no ledger is touched.
CREATE FUNCTION bn002_guard_head() RETURNS trigger LANGUAGE plpgsql AS $bn002$
DECLARE p record; a numeric; b numeric; max_offset numeric;
  src_count integer; alloc_count integer;
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'BN-002 pair history cannot be deleted'; END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.version<>0 OR NEW.current_proposal_id IS NOT NULL
       OR NOT EXISTS(
         SELECT 1 FROM group_settlement_cycles c
         JOIN group_settlement_cycle_snapshots s ON s.cycle_id=c.id
         JOIN group_settlement_settings cfg ON cfg.group_id=c.group_id
         WHERE c.id=NEW.cycle_id AND c.group_id=NEW.group_id
           AND c.state='locked' AND c.version=3
           AND cfg.requested_enabled AND cfg.requested_bilateral_netting
       )
    THEN RAISE EXCEPTION 'BN-002 head requires enabled locked cycle'; END IF;
    RETURN NEW;
  END IF;
  IF NEW.version<>OLD.version+1 OR NEW.group_id<>OLD.group_id
     OR NEW.cycle_id<>OLD.cycle_id OR NEW.party_low<>OLD.party_low
     OR NEW.party_high<>OLD.party_high OR
     NEW.current_proposal_id IS NULL THEN
    RAISE EXCEPTION 'BN-002 illegal pair-head revision';
  END IF;
  SELECT * INTO p FROM group_settlement_bilateral_proposals
    WHERE id=NEW.current_proposal_id AND group_id=NEW.group_id
      AND cycle_id=NEW.cycle_id AND party_low=NEW.party_low
      AND party_high=NEW.party_high AND version=NEW.version;
  IF p.id IS NULL OR NOT EXISTS(
      SELECT 1 FROM group_settlement_cycle_snapshots s
      WHERE s.cycle_id=NEW.cycle_id AND s.group_id=NEW.group_id
        AND s.fingerprint=p.snapshot_fingerprint)
    OR NOT EXISTS(
      SELECT 1 FROM group_settlement_settings cfg
      JOIN group_settlement_cycles c ON c.group_id=cfg.group_id
      WHERE c.id=NEW.cycle_id AND c.state='locked' AND c.version=3
        AND cfg.requested_enabled AND cfg.requested_bilateral_netting
    ) THEN RAISE EXCEPTION 'BN-002 proposal snapshot or opt-in invalid'; END IF;
  SELECT count(*)::int, count(*) FILTER(WHERE proposed_minor>0)::int,
    COALESCE(sum(proposed_minor) FILTER(
      WHERE debtor_id=NEW.party_low AND creditor_id=NEW.party_high),0),
    COALESCE(sum(proposed_minor) FILTER(
      WHERE debtor_id=NEW.party_high AND creditor_id=NEW.party_low),0)
  INTO src_count,alloc_count,a,b
  FROM group_settlement_bilateral_sources WHERE proposal_id=p.id;
  SELECT LEAST(
    COALESCE(sum(available_before_minor) FILTER(
      WHERE debtor_id=NEW.party_low AND creditor_id=NEW.party_high),0),
    COALESCE(sum(available_before_minor) FILTER(
      WHERE debtor_id=NEW.party_high AND creditor_id=NEW.party_low),0))
  INTO max_offset
  FROM group_settlement_bilateral_sources WHERE proposal_id=p.id;
  IF src_count<>p.source_count OR alloc_count<>p.allocation_count OR
     p.offset_minor<>max_offset OR
     a<>p.offset_minor OR b<>p.offset_minor OR p.offset_minor<=0
     OR NOT EXISTS(SELECT 1 FROM group_settlement_bilateral_sources x
          WHERE x.proposal_id=p.id AND x.debtor_id=NEW.party_low AND x.creditor_id=NEW.party_high
            AND x.proposed_minor>0)
     OR NOT EXISTS(SELECT 1 FROM group_settlement_bilateral_sources x
          WHERE x.proposal_id=p.id AND x.debtor_id=NEW.party_high AND x.creditor_id=NEW.party_low
            AND x.proposed_minor>0)
  THEN RAISE EXCEPTION 'BN-002 proposal sums are not bilaterally conserved'; END IF;
  -- Equal opposite-side sums alone are NOT sufficient: source rows MUST
  -- follow the pure BN-001 FIFO algorithm (local invoice date, source UUID).
  IF EXISTS (
    SELECT 1 FROM (
      SELECT proposed_minor,
        LEAST(available_before_minor,
          GREATEST(p.offset_minor-
            COALESCE(sum(available_before_minor) OVER (
              PARTITION BY debtor_id
              ORDER BY occurred_on,obligation_id
              ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING),0),0))
          AS expected_minor
      FROM group_settlement_bilateral_sources
      WHERE proposal_id=p.id
    ) expected WHERE proposed_minor<>expected_minor
  ) THEN
    RAISE EXCEPTION 'BN-002 noncanonical source allocation order';
  END IF;
  IF NOT EXISTS(
      SELECT 1 FROM group_members m
      WHERE m.group_id=NEW.group_id AND m.user_id=p.created_by
        AND m.status='active' AND m.user_id IN (NEW.party_low,NEW.party_high))
     OR (
       SELECT count(*) FROM group_members m WHERE m.group_id=NEW.group_id
         AND m.user_id IN (NEW.party_low,NEW.party_high)
         AND m.status='active'
     )<>2 THEN
    RAISE EXCEPTION 'BN-002 proposal parties must be active';
  END IF;
  IF src_count<>(SELECT count(*)::int
     FROM group_settlement_cycle_snapshot_obligations src
     WHERE src.cycle_id=NEW.cycle_id AND src.group_id=NEW.group_id
       AND ((src.debtor_id=NEW.party_low AND src.creditor_id=NEW.party_high)
         OR (src.debtor_id=NEW.party_high AND src.creditor_id=NEW.party_low)))
  THEN RAISE EXCEPTION 'BN-002 source proof incomplete'; END IF;
  IF EXISTS(
    SELECT 1 FROM group_settlement_bilateral_sources x
    JOIN obligations o ON o.id=x.obligation_id
    JOIN expenses e ON e.id=o.expense_id
    LEFT JOIN LATERAL (
      SELECT COALESCE(sum(a.amount_minor) FILTER(WHERE st.status='confirmed'),0) AS paid,
        COALESCE(sum(a.amount_minor) FILTER(WHERE st.status='pending'),0) AS pending
      FROM settlement_allocations a
      JOIN settlements st ON st.id=a.settlement_id AND st.group_id=o.group_id
      WHERE a.obligation_id=o.id
    ) cash ON true
    WHERE x.proposal_id=p.id
      AND (o.voided_at IS NOT NULL OR e.deleted_at IS NOT NULL
        OR e.version<>x.expense_version OR o.expense_version<>x.expense_version
        OR o.amount_minor<>x.original_minor
        OR cash.paid<>x.confirmed_cash_minor
        OR cash.pending<>x.pending_cash_minor
        OR x.available_before_minor<>o.amount_minor-cash.paid-cash.pending)
  ) THEN RAISE EXCEPTION 'BN-002 proposal source changed after preview'; END IF;
  RETURN NEW;
END;
$bn002$;
CREATE TRIGGER bn002_head_guard BEFORE INSERT OR UPDATE OR DELETE
  ON group_settlement_bilateral_heads FOR EACH ROW
  EXECUTE FUNCTION bn002_guard_head();

-- BN-003/BN-004 will independently design approvals/reservations and
-- noncash discharge. Nothing in this migration modifies the money ledger.
