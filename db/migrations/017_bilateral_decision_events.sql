-- BN-003: append-only bilateral signatory decisions. NO noncash ledger,
-- no offset reservation, no money mutation and no auto-application.
-- Proposal documents from 016 remain immutable.
CREATE TABLE group_settlement_bilateral_decision_events (
  id uuid PRIMARY KEY,
  proposal_id uuid NOT NULL,
  group_id uuid NOT NULL,
  cycle_id uuid NOT NULL,
  party_low text COLLATE "C" NOT NULL,
  party_high text COLLATE "C" NOT NULL,
  actor_id text REFERENCES "user"(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK(event_type IN
    ('approve','reject','revoke','invalidated','expired')),
  request_key uuid NOT NULL,
  request_digest char(64) NOT NULL CHECK(request_digest ~ '^[0-9a-f]{64}$'),
  source_fingerprint char(64) NOT NULL CHECK(source_fingerprint ~ '^[0-9a-f]{64}$'),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY(proposal_id,group_id,cycle_id,party_low,party_high)
    REFERENCES group_settlement_bilateral_proposals
      (id,group_id,cycle_id,party_low,party_high) ON DELETE RESTRICT,
  CONSTRAINT bn003_actor_kind CHECK (
    (event_type IN ('approve','reject','revoke') AND actor_id IS NOT NULL)
    OR (event_type IN ('invalidated','expired') AND actor_id IS NULL)),
  CONSTRAINT bn003_pair_actor CHECK (actor_id IS NULL OR actor_id IN (party_low,party_high)),
  CONSTRAINT bn003_request_unique UNIQUE(proposal_id,request_key)
);
-- One idempotency key cannot represent two decisions by the same
-- participant, even across separate versions of the same group's cycle.
CREATE UNIQUE INDEX bn003_actor_request_scope
 ON group_settlement_bilateral_decision_events(group_id,actor_id,request_key)
 WHERE actor_id IS NOT NULL;
CREATE UNIQUE INDEX bn003_one_approval_per_party
 ON group_settlement_bilateral_decision_events(proposal_id,actor_id)
 WHERE event_type='approve';
CREATE UNIQUE INDEX bn003_one_terminal_event
 ON group_settlement_bilateral_decision_events(proposal_id)
 WHERE event_type IN ('reject','revoke','invalidated','expired');
CREATE INDEX bn003_decision_history
 ON group_settlement_bilateral_decision_events(proposal_id,recorded_at,id);

CREATE FUNCTION bn003_immutable_event() RETURNS trigger LANGUAGE plpgsql AS $bn003$
BEGIN RAISE EXCEPTION 'BN-003 decisions are append-only'; END;
$bn003$;
CREATE TRIGGER bn003_event_immutable BEFORE UPDATE OR DELETE
 ON group_settlement_bilateral_decision_events FOR EACH ROW
 EXECUTE FUNCTION bn003_immutable_event();

-- All decision events MUST refer to the current immutable proposal.
-- Never permit an approval to bypass a changed confirmed/pending cash
-- balance or an archived/disabled group. Explicit system invalidation and
-- expiry are permitted ONLY under their factual predicates.
CREATE FUNCTION bn003_guard_event() RETURNS trigger LANGUAGE plpgsql AS $bn003$
DECLARE p record; old_terminal boolean; old_approvals integer;
  same_actor_approval boolean; current_head uuid;
  is_live boolean; source_changed boolean; active_pair boolean;
BEGIN
  -- Serialize independent SQL workers on the SAME immutable proposal.
  -- Without this lock a concurrent APPROVE and REJECT could both observe
  -- no terminal event before either INSERT commits.
  SELECT * INTO p FROM group_settlement_bilateral_proposals
    WHERE id=NEW.proposal_id FOR UPDATE;
  IF NOT FOUND OR NEW.source_fingerprint<>p.source_fingerprint
     OR NEW.group_id<>p.group_id OR NEW.cycle_id<>p.cycle_id
     OR NEW.party_low<>p.party_low OR NEW.party_high<>p.party_high
  THEN RAISE EXCEPTION 'BN-003 decision identity/fingerprint mismatch'; END IF;

  SELECT h.current_proposal_id INTO current_head
    FROM group_settlement_bilateral_heads h
    WHERE h.group_id=p.group_id AND h.cycle_id=p.cycle_id
      AND h.party_low=p.party_low AND h.party_high=p.party_high;
  IF current_head IS DISTINCT FROM p.id
    THEN RAISE EXCEPTION 'BN-003 superseded proposal cannot receive decisions';
  END IF;
  SELECT EXISTS (SELECT 1 FROM group_settlement_bilateral_decision_events e
    WHERE e.proposal_id=p.id AND e.event_type IN
      ('reject','revoke','invalidated','expired')) INTO old_terminal;
  IF old_terminal THEN RAISE EXCEPTION 'BN-003 proposal is terminal'; END IF;

  SELECT count(*)::int,COALESCE(bool_or(e.actor_id=NEW.actor_id),false)
  INTO old_approvals,same_actor_approval
  FROM group_settlement_bilateral_decision_events e
  WHERE e.proposal_id=p.id AND e.event_type='approve';

  SELECT EXISTS(
    SELECT 1 FROM groups g
    JOIN group_settlement_settings s ON s.group_id=g.id
    JOIN group_settlement_cycles c ON c.id=p.cycle_id AND c.group_id=g.id
    JOIN group_settlement_cycle_snapshots snap ON snap.cycle_id=c.id
    WHERE g.id=p.group_id AND g.archived_at IS NULL
      AND s.requested_enabled AND s.requested_bilateral_netting
      AND c.state='locked' AND c.version=3
      AND snap.fingerprint=p.snapshot_fingerprint
  ) INTO is_live;

  SELECT (SELECT count(*)=2 FROM group_members m WHERE m.group_id=p.group_id
    AND m.user_id IN (p.party_low,p.party_high) AND m.status='active')
    INTO active_pair;

  -- SQL validation of ORIGINAL obligation amount, version, and confirmed
  -- /pending cash. The application additionally compares full SHA256.
  SELECT EXISTS(
    SELECT 1 FROM group_settlement_bilateral_sources src
    JOIN obligations o ON o.id=src.obligation_id
    JOIN expenses e ON e.id=o.expense_id
    LEFT JOIN LATERAL (
      SELECT COALESCE(sum(a.amount_minor) FILTER(WHERE st.status='confirmed'),0) AS confirmed,
        COALESCE(sum(a.amount_minor) FILTER(WHERE st.status='pending'),0) AS pending
      FROM settlement_allocations a
      JOIN settlements st ON st.id=a.settlement_id AND st.group_id=o.group_id
      WHERE a.obligation_id=o.id
    ) livecash ON true
    WHERE src.proposal_id=p.id AND (
      o.voided_at IS NOT NULL OR e.deleted_at IS NOT NULL
      OR o.amount_minor<>src.original_minor OR
      o.expense_version<>src.expense_version OR
      (e.version<>src.expense_version AND NOT
        (e.version=src.expense_version+1 AND e.completed_at IS NOT NULL
          AND e.completed_by=e.created_by))
      OR src.confirmed_cash_minor<>livecash.confirmed
      OR src.pending_cash_minor<>livecash.pending
      OR src.available_before_minor<>o.amount_minor-livecash.confirmed-livecash.pending)
  ) INTO source_changed;

  IF NEW.event_type='approve' THEN
    IF old_approvals>=2 OR same_actor_approval OR
       clock_timestamp()>=p.created_at+interval '72 hours' OR
       NOT is_live OR NOT active_pair OR source_changed
    THEN RAISE EXCEPTION 'BN-003 approval denied for stale/expired/duplicate state'; END IF;
  ELSIF NEW.event_type='reject' THEN
    IF clock_timestamp()>=p.created_at+interval '72 hours' OR
       NOT is_live OR NOT active_pair OR source_changed THEN
      RAISE EXCEPTION 'BN-003 rejection denied for stale or expired state';
    END IF;
    IF old_approvals>=2 THEN
      RAISE EXCEPTION 'BN-003 fully agreed proposal cannot be rejected';
    END IF;
  ELSIF NEW.event_type='revoke' THEN
    IF clock_timestamp()>=p.created_at+interval '72 hours' OR
       NOT is_live OR NOT active_pair OR source_changed THEN
      RAISE EXCEPTION 'BN-003 revocation denied for stale or expired state';
    END IF;
    IF NOT same_actor_approval THEN
      RAISE EXCEPTION 'BN-003 only an approving signatory can revoke';
    END IF;
  ELSIF NEW.event_type='expired' THEN
    IF clock_timestamp()<p.created_at+interval '72 hours' THEN
      RAISE EXCEPTION 'BN-003 proposal has not expired';
    END IF;
  ELSIF NEW.event_type='invalidated' THEN
    IF is_live AND active_pair AND NOT source_changed THEN
      RAISE EXCEPTION 'BN-003 proposal has not been invalidated';
    END IF;
  END IF;
  RETURN NEW;
END;
$bn003$;
CREATE TRIGGER bn003_event_guard BEFORE INSERT
 ON group_settlement_bilateral_decision_events FOR EACH ROW
 EXECUTE FUNCTION bn003_guard_event();

-- Durable invalidation at the EXACT commit that changes source money.
-- A proposal must NEVER become valid again if pending cash was created and
-- later cancelled back to the original fingerprint: its old approvals
-- were invalidated at the first write. Every cash writer already holds
-- the group row lock. The proposal lock serializes these events with
-- direct SQL decision inserts as well.
CREATE FUNCTION bn003_auto_invalidate(gid uuid, source_id uuid, affected_member text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $bn003$
BEGIN
  INSERT INTO group_settlement_bilateral_decision_events
    (id,proposal_id,group_id,cycle_id,party_low,party_high,
     actor_id,event_type,request_key,request_digest,source_fingerprint)
  SELECT gen_random_uuid(),p.id,p.group_id,p.cycle_id,p.party_low,p.party_high,
    NULL,'invalidated',gen_random_uuid(),
    md5('bn003-auto-v1:'||p.id::text)||md5('invalidate:'||p.id::text),
    p.source_fingerprint
  FROM group_settlement_bilateral_heads h
  JOIN group_settlement_bilateral_proposals p
    ON p.id=h.current_proposal_id AND p.group_id=h.group_id
  WHERE h.group_id=gid
    AND (affected_member IS NULL OR p.party_low=affected_member
      OR p.party_high=affected_member)
    AND (source_id IS NULL OR EXISTS (
      SELECT 1 FROM group_settlement_bilateral_sources x
      WHERE x.proposal_id=p.id AND x.obligation_id=source_id))
    AND NOT EXISTS(SELECT 1 FROM group_settlement_bilateral_decision_events e
      WHERE e.proposal_id=p.id AND e.event_type IN
        ('reject','revoke','invalidated','expired'))
  ON CONFLICT DO NOTHING;
END;
$bn003$;

CREATE FUNCTION bn003_allocation_invalidation() RETURNS trigger LANGUAGE plpgsql AS $bn003$
DECLARE oid uuid; gid uuid; cash_status text;
BEGIN
  IF TG_OP IN ('UPDATE','DELETE') THEN
    SELECT st.status INTO cash_status FROM settlements st
     WHERE st.id=OLD.settlement_id;
    IF cash_status IN ('pending','confirmed') THEN
      PERFORM bn003_auto_invalidate(OLD.group_id,OLD.obligation_id);
    END IF;
  END IF;
  IF TG_OP IN ('INSERT','UPDATE') THEN
    SELECT st.status INTO cash_status FROM settlements st
     WHERE st.id=NEW.settlement_id;
    IF cash_status IN ('pending','confirmed') THEN
      PERFORM bn003_auto_invalidate(NEW.group_id,NEW.obligation_id);
    END IF;
  END IF;
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END;
$bn003$;
CREATE TRIGGER bn003_allocation_changed
  AFTER INSERT OR UPDATE OR DELETE ON settlement_allocations
  FOR EACH ROW EXECUTE FUNCTION bn003_allocation_invalidation();

CREATE FUNCTION bn003_settlement_cash_invalidation() RETURNS trigger LANGUAGE plpgsql AS $bn003$
DECLARE obligation_row record;
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    FOR obligation_row IN
      SELECT DISTINCT obligation_id FROM settlement_allocations
      WHERE settlement_id=NEW.id
    LOOP
      PERFORM bn003_auto_invalidate(NEW.group_id,obligation_row.obligation_id);
    END LOOP;
  END IF;
  RETURN NEW;
END;
$bn003$;
CREATE TRIGGER bn003_cash_status_changed
  AFTER UPDATE OF status ON settlements FOR EACH ROW
  EXECUTE FUNCTION bn003_settlement_cash_invalidation();

-- Opting out or losing either signatory's active membership invalidates
-- existing consent irreversibly, even if a group later re-enables the
-- feature or the same person rejoins.
CREATE FUNCTION bn003_settings_invalidation() RETURNS trigger LANGUAGE plpgsql AS $bn003$
BEGIN
  IF (OLD.requested_enabled OR OLD.requested_bilateral_netting)
    AND (NOT NEW.requested_enabled OR NOT NEW.requested_bilateral_netting)
  THEN PERFORM bn003_auto_invalidate(NEW.group_id,NULL); END IF;
  RETURN NEW;
END;
$bn003$;
CREATE TRIGGER bn003_cycle_optout_changed
  AFTER UPDATE OF requested_enabled,requested_bilateral_netting
  ON group_settlement_settings FOR EACH ROW
  EXECUTE FUNCTION bn003_settings_invalidation();

CREATE FUNCTION bn003_member_invalidation() RETURNS trigger LANGUAGE plpgsql AS $bn003$
BEGIN
  IF OLD.status='active' AND NEW.status<>'active' THEN
    PERFORM bn003_auto_invalidate(NEW.group_id,NULL,NEW.user_id);
  END IF;
  RETURN NEW;
END;
$bn003$;
CREATE TRIGGER bn003_member_left
  AFTER UPDATE OF status ON group_members FOR EACH ROW
  EXECUTE FUNCTION bn003_member_invalidation();

CREATE FUNCTION bn003_archive_invalidation() RETURNS trigger LANGUAGE plpgsql AS $bn003$
BEGIN
  IF OLD.archived_at IS NULL AND NEW.archived_at IS NOT NULL THEN
    PERFORM bn003_auto_invalidate(NEW.id,NULL);
  END IF;
  RETURN NEW;
END;
$bn003$;
CREATE TRIGGER bn003_group_archived
  AFTER UPDATE OF archived_at ON groups FOR EACH ROW
  EXECUTE FUNCTION bn003_archive_invalidation();

-- Deliberately NO approval/apply table and NO changes to financial sources.
