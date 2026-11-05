-- SC-009: notifications, immutable two-party disputes, audit trace.
-- Data only; NOT a financial ledger mutation or release flag.
ALTER TABLE notifications ALTER COLUMN settlement_id DROP NOT NULL;
ALTER TABLE notifications ALTER COLUMN actor_id DROP NOT NULL;
ALTER TABLE notifications DROP CONSTRAINT notifications_kind_check;
ALTER TABLE notifications ADD COLUMN cycle_id uuid;
ALTER TABLE notifications ADD COLUMN event_key varchar(160);
ALTER TABLE notifications
  ADD CONSTRAINT sc009_notification_scope CHECK(
    (settlement_id IS NOT NULL AND cycle_id IS NULL AND
      kind IN ('settlement_requested','settlement_confirmed',
        'settlement_rejected','settlement_cancelled'))
    OR
    (settlement_id IS NULL AND cycle_id IS NOT NULL AND kind IN (
      'cycle_review','cycle_locked','setoff_proposed','setoff_decision',
      'setoff_applied','late_invoice_attributed',
      'cycle_dispute_opened','cycle_dispute_responded',
      'cycle_dispute_closed','cycle_reminder')) );
ALTER TABLE notifications
 ADD CONSTRAINT sc009_cycle_notification_fk FOREIGN KEY(cycle_id,group_id)
 REFERENCES group_settlement_cycles(id,group_id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX sc009_notification_event_unique
  ON notifications(recipient_id,event_key) WHERE event_key IS NOT NULL;
CREATE INDEX sc009_notification_cycle_idx
  ON notifications(group_id,cycle_id,created_at DESC)
  WHERE cycle_id IS NOT NULL;

CREATE UNIQUE INDEX sc009_snapshot_obligation_fk
 ON group_settlement_cycle_snapshot_obligations(cycle_id,group_id,obligation_id);

CREATE TABLE group_settlement_cycle_disputes(
 id uuid PRIMARY KEY,
 group_id uuid NOT NULL,
 cycle_id uuid NOT NULL,
 obligation_id uuid NOT NULL,
 reporter_id text NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
 counterparty_id text NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
 reason varchar(500) NOT NULL CHECK(length(btrim(reason)) BETWEEN 10 AND 500),
 request_key uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CONSTRAINT sc009_dispute_request_unique UNIQUE(group_id,reporter_id,request_key),
 CONSTRAINT sc009_dispute_origin_fk FOREIGN KEY(cycle_id,group_id,obligation_id)
   REFERENCES group_settlement_cycle_snapshot_obligations
   (cycle_id,group_id,obligation_id) ON DELETE RESTRICT,
 CONSTRAINT sc009_dispute_not_self CHECK(reporter_id<>counterparty_id)
);
CREATE INDEX sc009_disputes_by_cycle
 ON group_settlement_cycle_disputes(group_id,cycle_id,created_at DESC,id DESC);
CREATE INDEX sc009_disputes_by_obligation
 ON group_settlement_cycle_disputes(obligation_id,created_at DESC);

CREATE TABLE group_settlement_cycle_dispute_events(
 id uuid PRIMARY KEY,
 dispute_id uuid NOT NULL REFERENCES group_settlement_cycle_disputes(id)
   ON DELETE RESTRICT,
 actor_id text NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
 event_type text NOT NULL CHECK(event_type IN('respond','resolve','withdraw')),
 body varchar(500) NOT NULL CHECK(length(btrim(body)) BETWEEN 5 AND 500),
 request_key uuid NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CONSTRAINT sc009_dispute_event_once UNIQUE(dispute_id,request_key)
);
CREATE INDEX sc009_dispute_events_history
 ON group_settlement_cycle_dispute_events(dispute_id,recorded_at,id);

-- Project the current dispute as an immutable ordered event chain.
-- Open -> counterparty respond -> reporter resolve; reporter can withdraw
-- while open. Neither role may fake the other's consent.
CREATE VIEW sc009_dispute_states AS
SELECT d.id,d.group_id,d.cycle_id,d.obligation_id,d.reporter_id,
 d.counterparty_id,d.created_at,
 CASE WHEN EXISTS(SELECT 1 FROM group_settlement_cycle_dispute_events e
                WHERE e.dispute_id=d.id AND e.event_type='withdraw')
       THEN 'withdrawn'
      WHEN EXISTS(SELECT 1 FROM group_settlement_cycle_dispute_events e
                WHERE e.dispute_id=d.id AND e.event_type='resolve')
       THEN 'resolved'
      WHEN EXISTS(SELECT 1 FROM group_settlement_cycle_dispute_events e
                WHERE e.dispute_id=d.id AND e.event_type='respond')
       THEN 'awaiting_reporter'
      ELSE 'open' END AS status
FROM group_settlement_cycle_disputes d;

CREATE FUNCTION sc009_dispute_guard() RETURNS trigger LANGUAGE plpgsql AS $sc009$
DECLARE ob record;
BEGIN
 IF TG_OP<>'INSERT' THEN
   RAISE EXCEPTION 'SC-009 dispute provenance is immutable';
 END IF;
 PERFORM 1 FROM groups WHERE id=NEW.group_id AND archived_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'SC-009 inactive group'; END IF;
 SELECT s.debtor_id,s.creditor_id INTO ob
  FROM group_settlement_cycle_snapshot_obligations s
  JOIN group_settlement_cycles c ON c.id=s.cycle_id AND c.group_id=s.group_id
  WHERE s.group_id=NEW.group_id AND s.cycle_id=NEW.cycle_id
    AND s.obligation_id=NEW.obligation_id AND c.state='locked';
 IF NOT FOUND OR
  NOT (NEW.reporter_id=ob.debtor_id AND NEW.counterparty_id=ob.creditor_id
    OR NEW.reporter_id=ob.creditor_id AND NEW.counterparty_id=ob.debtor_id)
  OR (SELECT count(*) FROM group_members m
        WHERE m.group_id=NEW.group_id AND m.status='active'
          AND m.user_id IN(NEW.reporter_id,NEW.counterparty_id))<>2
 THEN RAISE EXCEPTION 'SC-009 dispute must belong to two actual active counterparties'; END IF;
 IF EXISTS(SELECT 1 FROM sc009_dispute_states s
      WHERE s.obligation_id=NEW.obligation_id AND
        s.status IN('open','awaiting_reporter'))
 THEN RAISE EXCEPTION 'SC-009 original obligation already has an active dispute'; END IF;
 RETURN NEW;
END;$sc009$;
CREATE TRIGGER sc009_dispute_guard
 BEFORE INSERT OR UPDATE OR DELETE ON group_settlement_cycle_disputes
 FOR EACH ROW EXECUTE FUNCTION sc009_dispute_guard();

CREATE FUNCTION sc009_dispute_event_guard() RETURNS trigger LANGUAGE plpgsql AS $sc009$
DECLARE d record; latest text;
BEGIN
 IF TG_OP<>'INSERT' THEN
   RAISE EXCEPTION 'SC-009 dispute events are immutable';
 END IF;
 SELECT * INTO d FROM group_settlement_cycle_disputes WHERE id=NEW.dispute_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'SC-009 dispute missing'; END IF;
 PERFORM 1 FROM groups WHERE id=d.group_id AND archived_at IS NULL FOR UPDATE;
 IF NOT FOUND OR NOT EXISTS(
   SELECT 1 FROM group_members WHERE group_id=d.group_id AND
     user_id=NEW.actor_id AND status='active')
 THEN RAISE EXCEPTION 'SC-009 inactive dispute actor/group'; END IF;
 SELECT status INTO latest FROM sc009_dispute_states WHERE id=d.id;
 IF latest IN('resolved','withdrawn') THEN
   RAISE EXCEPTION 'SC-009 terminal dispute';
 END IF;
 IF NOT (
   (NEW.event_type='respond' AND NEW.actor_id=d.counterparty_id AND latest='open')
   OR (NEW.event_type='resolve' AND NEW.actor_id=d.reporter_id AND latest='awaiting_reporter')
   OR (NEW.event_type='withdraw' AND NEW.actor_id=d.reporter_id AND latest IN('open','awaiting_reporter'))
 ) THEN RAISE EXCEPTION 'SC-009 dispute transition or counterparty invalid'; END IF;
 RETURN NEW;
END;$sc009$;
CREATE TRIGGER sc009_dispute_event_guard
 BEFORE INSERT OR UPDATE OR DELETE ON group_settlement_cycle_dispute_events
 FOR EACH ROW EXECUTE FUNCTION sc009_dispute_event_guard();

-- A dispute does not reverse already-confirmed cash/noncash. Future cycle
-- cash and noncash applications touching a disputed source must FAIL CLOSED.
CREATE FUNCTION sc009_no_disputed_money() RETURNS trigger LANGUAGE plpgsql AS $sc009$
BEGIN
 IF TG_TABLE_NAME='group_settlement_bilateral_applications' THEN
   IF EXISTS(
     SELECT 1 FROM group_settlement_bilateral_sources src
     JOIN sc009_dispute_states d ON d.obligation_id=src.obligation_id
     WHERE src.proposal_id=NEW.proposal_id
       AND d.status IN('open','awaiting_reporter')
   ) THEN RAISE EXCEPTION 'SC-009 disputed source cannot be applied'; END IF;
 ELSE
   IF EXISTS(
     SELECT 1 FROM group_settlement_cycle_snapshot_obligations src
     JOIN sc009_dispute_states d ON d.obligation_id=src.obligation_id
     JOIN bn005_obligation_balances b ON b.obligation_id=src.obligation_id
     WHERE src.group_id=NEW.group_id AND src.cycle_id=NEW.cycle_id
       AND src.debtor_id=NEW.debtor_id AND src.creditor_id=NEW.creditor_id
       AND b.outstanding_minor>0 AND d.status IN('open','awaiting_reporter')
   ) THEN RAISE EXCEPTION 'SC-009 disputed source cannot be paid via cycle'; END IF;
 END IF;
 RETURN NEW;
END;$sc009$;
CREATE TRIGGER sc009_no_disputed_noncash BEFORE INSERT
 ON group_settlement_bilateral_applications
 FOR EACH ROW EXECUTE FUNCTION sc009_no_disputed_money();
CREATE TRIGGER sc009_no_disputed_cash BEFORE INSERT
 ON group_settlement_cycle_repayments
 FOR EACH ROW EXECUTE FUNCTION sc009_no_disputed_money();

-- Even an already-created PENDING cash request must not become
-- CONFIRMED while an ORIGINAL allocated obligation is disputed.
-- It stays pending until the two real people settle the dispute first.
CREATE FUNCTION sc009_no_disputed_cash_confirmation()
RETURNS trigger LANGUAGE plpgsql AS $sc009$
BEGIN
 IF OLD.status='pending' AND NEW.status='confirmed' AND EXISTS(
   SELECT 1 FROM settlement_allocations sa
   JOIN sc009_dispute_states d ON d.obligation_id=sa.obligation_id
   WHERE sa.settlement_id=NEW.id
     AND d.status IN('open','awaiting_reporter')
 ) THEN RAISE EXCEPTION 'SC-009 disputed original obligation cannot be cash-confirmed';
 END IF;
 RETURN NEW;
END;$sc009$;
CREATE TRIGGER sc009_no_disputed_cash_confirmation
 BEFORE UPDATE OF status ON settlements
 FOR EACH ROW EXECUTE FUNCTION sc009_no_disputed_cash_confirmation();

-- Insert a deduplicated, push-compatible notification from a trusted
-- existing event. The same event can be replayed without duplicate alerts.
CREATE FUNCTION sc009_emit_notice(
 gid uuid,cid uuid,recipient text,actor text,event_id text,
 category text,title_text text,body_text text,link_text text)
RETURNS void LANGUAGE plpgsql AS $sc009$
DECLARE nid uuid;
BEGIN
 IF recipient IS NULL OR recipient=actor OR
    NOT EXISTS(SELECT 1 FROM group_members
      WHERE group_id=gid AND user_id=recipient AND status='active')
 THEN RETURN; END IF;
 INSERT INTO notifications
  (id,recipient_id,actor_id,group_id,cycle_id,kind,title,body,href,event_key)
 VALUES(gen_random_uuid(),recipient,actor,gid,cid,category,
   left(title_text,160),left(body_text,500),left(link_text,300),
   left(event_id,160))
 ON CONFLICT(recipient_id,event_key) WHERE event_key IS NOT NULL DO NOTHING
 RETURNING id INTO nid;
 IF nid IS NOT NULL THEN
   INSERT INTO notification_push_jobs(notification_id,subscription_id)
   SELECT nid,ps.id FROM push_subscriptions ps
   LEFT JOIN notification_preferences pref ON pref.user_id=ps.user_id
   WHERE ps.user_id=recipient AND COALESCE(pref.push_enabled,true)
   ON CONFLICT DO NOTHING;
 END IF;
END;$sc009$;

CREATE FUNCTION sc009_event_notification() RETURNS trigger LANGUAGE plpgsql AS $sc009$
DECLARE recipient text; proposal record; disp record;
BEGIN
 IF TG_TABLE_NAME='group_settlement_cycle_events' THEN
   IF NEW.event_type='review_requested' OR NEW.event_type='snapshot_locked' THEN
     FOR recipient IN SELECT user_id FROM group_members
       WHERE group_id=NEW.group_id AND status='active' LOOP
       PERFORM sc009_emit_notice(NEW.group_id,NEW.cycle_id,recipient,NEW.actor_id,
         'cycle:'||NEW.id::text,
         CASE WHEN NEW.event_type='review_requested' THEN 'cycle_review' ELSE 'cycle_locked' END,
         CASE WHEN NEW.event_type='review_requested' THEN 'Kỳ đang chờ rà soát' ELSE 'Kỳ đã khóa sổ' END,
         'Xem chi tiết kỳ và nguồn công nợ. Chưa có chuyển khoản tự động.',
         '/groups/'||NEW.group_id||'/cycles/'||NEW.cycle_id);
     END LOOP;
   END IF;
 ELSIF TG_TABLE_NAME='group_settlement_bilateral_proposals' THEN
   recipient:=CASE WHEN NEW.created_by=NEW.party_low THEN NEW.party_high ELSE NEW.party_low END;
   PERFORM sc009_emit_notice(NEW.group_id,NEW.cycle_id,recipient,NEW.created_by,
     'proposal:'||NEW.id,'setoff_proposed','Đề xuất bù trừ hai chiều',
     'Có đề xuất phi tiền mặt cần xem xét. Chưa trừ công nợ.',
     '/groups/'||NEW.group_id||'/cycles/'||NEW.cycle_id);
 ELSIF TG_TABLE_NAME='group_settlement_bilateral_decision_events' THEN
   FOR recipient IN SELECT p.party_low FROM group_settlement_bilateral_proposals p WHERE p.id=NEW.proposal_id
     UNION SELECT p.party_high FROM group_settlement_bilateral_proposals p WHERE p.id=NEW.proposal_id LOOP
     PERFORM sc009_emit_notice(NEW.group_id,NEW.cycle_id,recipient,NEW.actor_id,
       'decision:'||NEW.id,'setoff_decision','Cập nhật đồng thuận bù trừ',
       CASE WHEN NEW.event_type='approve' THEN 'Một bên đã đồng ý; còn cần đủ hai người.'
        WHEN NEW.event_type='reject' THEN 'Đề xuất đã bị từ chối.'
        WHEN NEW.event_type='revoke' THEN 'Một bên đã rút lại đồng thuận.'
        ELSE 'Đề xuất không còn hợp lệ; cần xem lại nguồn công nợ.' END,
       '/groups/'||NEW.group_id||'/cycles/'||NEW.cycle_id);
   END LOOP;
 ELSIF TG_TABLE_NAME='group_settlement_bilateral_applications' THEN
   recipient:=CASE WHEN NEW.applied_by=NEW.party_low THEN NEW.party_high ELSE NEW.party_low END;
   PERFORM sc009_emit_notice(NEW.group_id,NEW.cycle_id,recipient,NEW.applied_by,
     'noncash:'||NEW.id,'setoff_applied','Đã ghi nhận bù trừ phi tiền mặt',
     'Bù trừ giảm công nợ gốc. Đây KHÔNG phải giao dịch chuyển khoản.',
     '/groups/'||NEW.group_id||'/cycles/'||NEW.cycle_id);
 ELSIF TG_TABLE_NAME='group_settlement_cycle_adjustments' THEN
   SELECT created_by INTO recipient FROM expenses WHERE id=NEW.expense_id;
   PERFORM sc009_emit_notice(NEW.group_id,NEW.target_cycle_id,recipient,NEW.actor_id,
     'late:'||NEW.id,'late_invoice_attributed','Hóa đơn muộn được gán kỳ',
     'Hóa đơn gốc đã được ghi nhận vào kỳ rà soát sau, không tạo hóa đơn mới.',
     '/groups/'||NEW.group_id||'/cycles/'||NEW.target_cycle_id);
 ELSIF TG_TABLE_NAME='group_settlement_cycle_disputes' THEN
   PERFORM sc009_emit_notice(NEW.group_id,NEW.cycle_id,NEW.counterparty_id,NEW.reporter_id,
     'dispute:'||NEW.id,'cycle_dispute_opened','Có tranh chấp công nợ gốc',
     'Người đối ứng đã gửi tranh chấp. Không tự sửa hóa đơn hoặc chuyển tiền.',
     '/groups/'||NEW.group_id||'/cycles/'||NEW.cycle_id);
 ELSIF TG_TABLE_NAME='group_settlement_cycle_dispute_events' THEN
   SELECT * INTO disp FROM group_settlement_cycle_disputes WHERE id=NEW.dispute_id;
   recipient:=CASE WHEN NEW.actor_id=disp.reporter_id THEN disp.counterparty_id ELSE disp.reporter_id END;
   PERFORM sc009_emit_notice(disp.group_id,disp.cycle_id,recipient,NEW.actor_id,
     'dispute-event:'||NEW.id,
     CASE WHEN NEW.event_type='respond' THEN 'cycle_dispute_responded' ELSE 'cycle_dispute_closed' END,
     CASE WHEN NEW.event_type='respond' THEN 'Có phản hồi tranh chấp'
       ELSE 'Tranh chấp đã kết thúc' END,
     'Xem lịch sử đối soát và các ý kiến; tiền gốc không tự thay đổi.',
     '/groups/'||disp.group_id||'/cycles/'||disp.cycle_id);
 END IF;
 RETURN NEW;
END;$sc009$;
CREATE TRIGGER sc009_cycle_notices AFTER INSERT ON group_settlement_cycle_events
 FOR EACH ROW EXECUTE FUNCTION sc009_event_notification();
CREATE TRIGGER sc009_proposal_notices AFTER INSERT ON group_settlement_bilateral_proposals
 FOR EACH ROW EXECUTE FUNCTION sc009_event_notification();
CREATE TRIGGER sc009_decision_notices AFTER INSERT ON group_settlement_bilateral_decision_events
 FOR EACH ROW EXECUTE FUNCTION sc009_event_notification();
CREATE TRIGGER sc009_applied_notices AFTER INSERT ON group_settlement_bilateral_applications
 FOR EACH ROW EXECUTE FUNCTION sc009_event_notification();
CREATE TRIGGER sc009_late_notices AFTER INSERT ON group_settlement_cycle_adjustments
 FOR EACH ROW EXECUTE FUNCTION sc009_event_notification();
CREATE TRIGGER sc009_dispute_notices AFTER INSERT ON group_settlement_cycle_disputes
 FOR EACH ROW EXECUTE FUNCTION sc009_event_notification();
CREATE TRIGGER sc009_dispute_event_notices AFTER INSERT ON group_settlement_cycle_dispute_events
 FOR EACH ROW EXECUTE FUNCTION sc009_event_notification();
