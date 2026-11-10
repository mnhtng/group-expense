-- BN-004 ONLY. Append-only TWO-SIDED NONCASH discharge, never cash.
-- No writes to obligations, expenses, settlements, settlement_allocations,
-- cycle state, or existing cash/balance projections (BN-005 is separate).
CREATE TABLE group_settlement_bilateral_applications (
  id uuid PRIMARY KEY,
  proposal_id uuid NOT NULL UNIQUE,
  group_id uuid NOT NULL,
  cycle_id uuid NOT NULL,
  party_low text COLLATE "C" NOT NULL,
  party_high text COLLATE "C" NOT NULL,
  applied_by text NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
  request_key uuid NOT NULL,
  request_digest char(64) NOT NULL CHECK(request_digest ~ '^[0-9a-f]{64}$'),
  source_fingerprint char(64) NOT NULL CHECK(source_fingerprint ~ '^[0-9a-f]{64}$'),
  snapshot_fingerprint char(64) NOT NULL CHECK(snapshot_fingerprint ~ '^[0-9a-f]{64}$'),
  proposal_version integer NOT NULL CHECK(proposal_version > 0),
  offset_minor numeric(38,0) NOT NULL CHECK(offset_minor > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY(proposal_id,group_id,cycle_id,party_low,party_high)
    REFERENCES group_settlement_bilateral_proposals
    (id,group_id,cycle_id,party_low,party_high) ON DELETE RESTRICT,
  CONSTRAINT bn004_ordered_pair CHECK(
    party_low < party_high AND applied_by IN(party_low,party_high)),
  CONSTRAINT bn004_one_application_per_cycle_pair
    UNIQUE(group_id,cycle_id,party_low,party_high),
  CONSTRAINT bn004_request_once UNIQUE(group_id,applied_by,request_key),
  CONSTRAINT bn004_application_identity UNIQUE(id,proposal_id,group_id,cycle_id)
);
CREATE INDEX bn004_applied_at ON group_settlement_bilateral_applications(group_id,created_at DESC);

CREATE TABLE group_settlement_bilateral_application_allocations (
  application_id uuid NOT NULL,
  proposal_id uuid NOT NULL,
  group_id uuid NOT NULL,
  cycle_id uuid NOT NULL,
  obligation_id uuid NOT NULL,
  debtor_id text NOT NULL,
  creditor_id text NOT NULL,
  amount_minor numeric(38,0) NOT NULL CHECK(amount_minor > 0),
  PRIMARY KEY(application_id,obligation_id),
  -- Until BN-005 integrates live confirmed set-off, each original
  -- obligation can be discharged at most ONCE. No stale double spending.
  CONSTRAINT bn004_one_noncash_discharge_per_obligation UNIQUE(obligation_id),
  FOREIGN KEY(application_id,proposal_id,group_id,cycle_id)
    REFERENCES group_settlement_bilateral_applications(id,proposal_id,group_id,cycle_id)
    ON DELETE RESTRICT,
  FOREIGN KEY(proposal_id,obligation_id)
    REFERENCES group_settlement_bilateral_sources(proposal_id,obligation_id)
    ON DELETE RESTRICT,
  CONSTRAINT bn004_not_self CHECK(debtor_id<>creditor_id)
);
CREATE INDEX bn004_alloc_by_proposal ON group_settlement_bilateral_application_allocations(proposal_id);

CREATE FUNCTION bn004_immutable_audit() RETURNS trigger LANGUAGE plpgsql AS $bn004$
BEGIN
  RAISE EXCEPTION 'BN-004 noncash application ledger is append-only';
END;$bn004$;
CREATE TRIGGER bn004_app_immutable BEFORE UPDATE OR DELETE
 ON group_settlement_bilateral_applications FOR EACH ROW
 EXECUTE FUNCTION bn004_immutable_audit();
CREATE TRIGGER bn004_alloc_immutable BEFORE UPDATE OR DELETE
 ON group_settlement_bilateral_application_allocations FOR EACH ROW
 EXECUTE FUNCTION bn004_immutable_audit();

-- A direct SQL writer cannot forge approval, revive stale consent,
-- apply an old HEAD, change the original pair or bypass live cash proof.
-- Group is locked first (same order as cash and prior proposal writers).
CREATE FUNCTION bn004_guard_application() RETURNS trigger LANGUAGE plpgsql AS $bn004$
DECLARE p record; h record; valid_count integer; is_valid boolean; now_at timestamptz;
BEGIN
  PERFORM 1 FROM groups
    WHERE id=NEW.group_id AND archived_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'BN-004 group inactive'; END IF;
  -- Serialize even raw SQL against BN-003 revoke/reject: that trigger
  -- locks the same immutable proposal row before inspecting decisions.
  SELECT * INTO p FROM group_settlement_bilateral_proposals
    WHERE id=NEW.proposal_id FOR UPDATE;
  IF NOT FOUND OR p.group_id<>NEW.group_id OR p.cycle_id<>NEW.cycle_id
    OR p.party_low<>NEW.party_low OR p.party_high<>NEW.party_high
    OR p.version<>NEW.proposal_version
    OR p.offset_minor<>NEW.offset_minor
    OR p.source_fingerprint<>NEW.source_fingerprint
    OR p.snapshot_fingerprint<>NEW.snapshot_fingerprint
    THEN RAISE EXCEPTION 'BN-004 altered proposal application'; END IF;
  SELECT * INTO h FROM group_settlement_bilateral_heads
    WHERE group_id=NEW.group_id AND cycle_id=NEW.cycle_id
      AND party_low=NEW.party_low AND party_high=NEW.party_high FOR UPDATE;
  IF h.current_proposal_id IS DISTINCT FROM NEW.proposal_id OR
    h.version<>NEW.proposal_version
    THEN RAISE EXCEPTION 'BN-004 proposal no longer current'; END IF;
  SELECT clock_timestamp() INTO now_at;
  IF now_at>=p.created_at+interval '72 hours'
    THEN RAISE EXCEPTION 'BN-004 approval expired'; END IF;
  SELECT EXISTS(
    SELECT 1 FROM group_settlement_cycles c
    JOIN group_settlement_cycle_snapshots snap
      ON snap.group_id=c.group_id AND snap.cycle_id=c.id
    JOIN group_settlement_settings cfg ON cfg.group_id=c.group_id
    WHERE c.id=NEW.cycle_id AND c.group_id=NEW.group_id
      AND c.state='locked' AND c.version=3
      AND cfg.requested_enabled AND cfg.requested_bilateral_netting
      AND snap.fingerprint=p.snapshot_fingerprint
  ) INTO is_valid;
  IF NOT is_valid OR (
    SELECT count(*) FROM group_members m WHERE m.group_id=NEW.group_id
      AND m.user_id IN(NEW.party_low,NEW.party_high)
      AND m.status='active')<>2 THEN
    RAISE EXCEPTION 'BN-004 feature, cycle or pair inactive';
  END IF;
  SELECT count(DISTINCT actor_id)::int INTO valid_count
    FROM group_settlement_bilateral_decision_events
    WHERE proposal_id=NEW.proposal_id AND event_type='approve'
      AND actor_id IN(NEW.party_low,NEW.party_high)
      AND source_fingerprint=p.source_fingerprint;
  IF valid_count<>2 OR EXISTS (
    SELECT 1 FROM group_settlement_bilateral_decision_events
    WHERE proposal_id=NEW.proposal_id AND event_type IN
      ('reject','revoke','invalidated','expired'))
  THEN RAISE EXCEPTION 'BN-004 requires two live, unretracted approvals'; END IF;
  -- Re-validate ALL original sources, including zero-available records.
  -- Source immutability and FIFO were previously guarded at publication.
  IF EXISTS(
    SELECT 1 FROM group_settlement_bilateral_sources s
    JOIN obligations o ON o.id=s.obligation_id AND o.group_id=s.group_id
    JOIN expenses e ON e.id=o.expense_id AND e.group_id=s.group_id
    LEFT JOIN LATERAL(
      SELECT COALESCE(sum(a.amount_minor) FILTER(WHERE st.status='confirmed'),0) AS confirmed,
             COALESCE(sum(a.amount_minor) FILTER(WHERE st.status='pending'),0) AS pending
      FROM settlement_allocations a
      JOIN settlements st ON st.id=a.settlement_id AND st.group_id=o.group_id
      WHERE a.obligation_id=o.id
    ) cash ON true
    WHERE s.proposal_id=NEW.proposal_id
      AND (o.voided_at IS NOT NULL OR e.deleted_at IS NOT NULL
        OR e.occurred_on<>s.occurred_on
        OR o.expense_version<>s.expense_version
        OR (e.version<>s.expense_version AND NOT
          (e.version=s.expense_version+1 AND e.completed_at IS NOT NULL
           AND e.completed_by=e.created_by))
        OR o.amount_minor<>s.original_minor
        OR cash.confirmed<>s.confirmed_cash_minor
        OR cash.pending<>s.pending_cash_minor
        OR s.available_before_minor<>o.amount_minor-cash.confirmed-cash.pending
        OR s.proposed_minor>s.available_before_minor)
  ) THEN RAISE EXCEPTION 'BN-004 stale or overbooked source'; END IF;
  IF EXISTS (
    SELECT 1 FROM group_settlement_bilateral_application_allocations a
    JOIN group_settlement_bilateral_sources s ON s.obligation_id=a.obligation_id
    WHERE s.proposal_id=NEW.proposal_id
  ) THEN RAISE EXCEPTION 'BN-004 source already discharged'; END IF;
  RETURN NEW;
END;$bn004$;
CREATE TRIGGER bn004_application_guard BEFORE INSERT
 ON group_settlement_bilateral_applications FOR EACH ROW
 EXECUTE FUNCTION bn004_guard_application();

CREATE FUNCTION bn004_guard_allocation() RETURNS trigger LANGUAGE plpgsql AS $bn004$
DECLARE a record;s record;
BEGIN
  SELECT * INTO a FROM group_settlement_bilateral_applications
    WHERE id=NEW.application_id;
  SELECT * INTO s FROM group_settlement_bilateral_sources
    WHERE proposal_id=NEW.proposal_id AND obligation_id=NEW.obligation_id;
  IF NOT FOUND OR a.id IS NULL OR
    NEW.proposal_id<>a.proposal_id OR NEW.group_id<>a.group_id OR
    NEW.cycle_id<>a.cycle_id OR
    NEW.debtor_id<>s.debtor_id OR NEW.creditor_id<>s.creditor_id OR
    NEW.amount_minor<>s.proposed_minor OR s.proposed_minor<=0
  THEN RAISE EXCEPTION 'BN-004 forged or mismatched allocation'; END IF;
  RETURN NEW;
END;$bn004$;
CREATE TRIGGER bn004_allocation_guard BEFORE INSERT
 ON group_settlement_bilateral_application_allocations FOR EACH ROW
 EXECUTE FUNCTION bn004_guard_allocation();

-- Deferred verification ensures application + BOTH full opposite allocations
-- are all-or-nothing at COMMIT. Inserting only one direction is impossible.
CREATE FUNCTION bn004_verify_conservation() RETURNS trigger LANGUAGE plpgsql AS $bn004$
DECLARE n integer; expected_count integer;a numeric;b numeric;missing_count integer;
BEGIN
  SELECT count(*)::int,
    COALESCE(sum(x.amount_minor) FILTER(
      WHERE x.debtor_id=NEW.party_low AND x.creditor_id=NEW.party_high),0),
    COALESCE(sum(x.amount_minor) FILTER(
      WHERE x.debtor_id=NEW.party_high AND x.creditor_id=NEW.party_low),0)
    INTO n,a,b
  FROM group_settlement_bilateral_application_allocations x
  WHERE x.application_id=NEW.id;
  SELECT count(*)::int INTO expected_count
  FROM group_settlement_bilateral_sources s
  WHERE s.proposal_id=NEW.proposal_id AND s.proposed_minor>0;
  SELECT count(*)::int INTO missing_count
  FROM group_settlement_bilateral_sources s
  WHERE s.proposal_id=NEW.proposal_id AND s.proposed_minor>0
    AND NOT EXISTS(
      SELECT 1 FROM group_settlement_bilateral_application_allocations x
      WHERE x.application_id=NEW.id AND x.obligation_id=s.obligation_id
        AND x.amount_minor=s.proposed_minor
        AND x.debtor_id=s.debtor_id AND x.creditor_id=s.creditor_id);
  IF n<>expected_count OR expected_count<2 OR missing_count<>0 OR
    a<>NEW.offset_minor OR b<>NEW.offset_minor
  THEN RAISE EXCEPTION 'BN-004 both-direction amounts and source counts must conserve'; END IF;
  RETURN NULL;
END;$bn004$;
CREATE CONSTRAINT TRIGGER bn004_conservation_on_commit
 AFTER INSERT ON group_settlement_bilateral_applications
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
 EXECUTE FUNCTION bn004_verify_conservation();

-- Once applied, a signer cannot revoke historical consent; an automatic
-- source invalidation may still be recorded later but never undoes the
-- immutable noncash application.
CREATE FUNCTION bn004_no_late_revoke() RETURNS trigger LANGUAGE plpgsql AS $bn004$
BEGIN
  IF NEW.event_type IN('revoke','reject') AND EXISTS(
    SELECT 1 FROM group_settlement_bilateral_applications
    WHERE proposal_id=NEW.proposal_id) THEN
    RAISE EXCEPTION 'BN-004 applied noncash consent cannot be revoked';
  END IF;
  RETURN NEW;
END;$bn004$;
CREATE TRIGGER bn004_applied_decision_guard BEFORE INSERT
 ON group_settlement_bilateral_decision_events FOR EACH ROW
 EXECUTE FUNCTION bn004_no_late_revoke();
