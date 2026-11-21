-- 030: one two-party CASH acknowledgement serves as consent for both
-- the exact original bilateral noncash offset and any real net transfer.
-- No balance is discharged when the first person clicks. The second
-- independent signed action commits the BN-004 proof AND confirmed cash.
-- Old BN-002/003/004 endpoints, historical proposals, and rows are untouched.
ALTER TABLE group_settlement_bilateral_proposals
  ADD COLUMN flow_origin text NOT NULL DEFAULT 'manual'
  CONSTRAINT bn030_proposal_origin_chk CHECK (flow_origin IN ('manual','paired_cash'));

CREATE TABLE group_settlement_bilateral_cash_intents (
  id uuid PRIMARY KEY,
  proposal_id uuid NOT NULL UNIQUE,
  group_id uuid NOT NULL,
  cycle_id uuid NOT NULL,
  party_low text COLLATE "C" NOT NULL,
  party_high text COLLATE "C" NOT NULL,
  initiated_by text NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
  debtor_id text,
  creditor_id text,
  amount_minor numeric(38,0) NOT NULL CHECK (amount_minor>=0),
  request_key uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','confirmed','rejected','cancelled')),
  resolved_by text REFERENCES "user"(id) ON DELETE RESTRICT,
  resolved_at timestamptz,
  application_id uuid UNIQUE REFERENCES group_settlement_bilateral_applications(id) ON DELETE RESTRICT,
  settlement_id uuid UNIQUE REFERENCES settlements(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY(proposal_id,group_id,cycle_id,party_low,party_high)
    REFERENCES group_settlement_bilateral_proposals(id,group_id,cycle_id,party_low,party_high)
    ON DELETE RESTRICT,
  UNIQUE(group_id,initiated_by,request_key),
  CONSTRAINT bn030_pair_order CHECK(party_low<party_high AND initiated_by IN(party_low,party_high)),
  CONSTRAINT bn030_net_direction CHECK(
    (amount_minor=0 AND debtor_id IS NULL AND creditor_id IS NULL)
    OR
    (amount_minor>0 AND debtor_id IS NOT NULL AND creditor_id IS NOT NULL
      AND debtor_id<>creditor_id AND
      debtor_id IN(party_low,party_high) AND creditor_id IN(party_low,party_high))
  ),
  CONSTRAINT bn030_finalize_guard CHECK(
    (status='pending' AND resolved_by IS NULL AND resolved_at IS NULL
      AND application_id IS NULL AND settlement_id IS NULL)
    OR
    (status='confirmed' AND resolved_by IS NOT NULL AND resolved_at IS NOT NULL
      AND resolved_by<>initiated_by AND resolved_by IN(party_low,party_high)
      AND application_id IS NOT NULL
      AND (amount_minor=0 OR settlement_id IS NOT NULL))
    OR
    (status IN('rejected','cancelled') AND resolved_by IS NOT NULL
      AND resolved_at IS NOT NULL AND application_id IS NULL AND settlement_id IS NULL)
  )
);
CREATE UNIQUE INDEX bn030_one_pending_pair
  ON group_settlement_bilateral_cash_intents(group_id,cycle_id,party_low,party_high)
  WHERE status='pending';
CREATE INDEX bn030_pair_history
  ON group_settlement_bilateral_cash_intents(group_id,cycle_id,party_low,party_high,created_at DESC);

CREATE FUNCTION bn030_intent_immutable_guard() RETURNS trigger LANGUAGE plpgsql AS $bn030$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'BN-030 cash intent history is immutable'; END IF;
  IF OLD.status<>'pending'
    OR NEW.status NOT IN('confirmed','rejected','cancelled')
    OR (to_jsonb(OLD)-'status'-'resolved_by'-'resolved_at'-'application_id'-'settlement_id')
        <> (to_jsonb(NEW)-'status'-'resolved_by'-'resolved_at'-'application_id'-'settlement_id')
    THEN RAISE EXCEPTION 'BN-030 invalid cash intent transition'; END IF;
  IF NEW.status='confirmed' AND
    (NEW.resolved_by=OLD.initiated_by OR NEW.application_id IS NULL)
    THEN RAISE EXCEPTION 'BN-030 two signers and applied proof required'; END IF;
  RETURN NEW;
END;$bn030$;
CREATE TRIGGER bn030_immutable_intent BEFORE UPDATE OR DELETE
 ON group_settlement_bilateral_cash_intents
 FOR EACH ROW EXECUTE FUNCTION bn030_intent_immutable_guard();

-- Override ONLY notification wording/visibility for the new paired-cash
-- origin. Existing manual setoff flows keep all their previous notices.
CREATE OR REPLACE FUNCTION sc009_event_notification() RETURNS trigger LANGUAGE plpgsql AS $sc009$
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
     'proposal:'||NEW.id,'setoff_proposed',
     CASE WHEN NEW.flow_origin='paired_cash' THEN 'Xác nhận tiền đã chuyển/nhận'
       ELSE 'Đề xuất bù trừ hai chiều' END,
     CASE WHEN NEW.flow_origin='paired_cash'
       THEN 'Bên đối ứng đã báo chuyển/nhận khoản chênh lệch. Xác nhận nếu đúng; việc bù nợ được ghi cùng lúc.'
       ELSE 'Có đề xuất phi tiền mặt cần xem xét. Chưa trừ công nợ.' END,
     '/groups/'||NEW.group_id||'/cycles/'||NEW.cycle_id);
 ELSIF TG_TABLE_NAME='group_settlement_bilateral_decision_events' THEN
   SELECT flow_origin INTO proposal FROM group_settlement_bilateral_proposals WHERE id=NEW.proposal_id;
   IF COALESCE(proposal.flow_origin,'manual')<>'paired_cash' THEN
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
   END IF;
 ELSIF TG_TABLE_NAME='group_settlement_bilateral_applications' THEN
   SELECT flow_origin INTO proposal FROM group_settlement_bilateral_proposals WHERE id=NEW.proposal_id;
   IF COALESCE(proposal.flow_origin,'manual')<>'paired_cash' THEN
     recipient:=CASE WHEN NEW.applied_by=NEW.party_low THEN NEW.party_high ELSE NEW.party_low END;
     PERFORM sc009_emit_notice(NEW.group_id,NEW.cycle_id,recipient,NEW.applied_by,
       'noncash:'||NEW.id,'setoff_applied','Đã ghi nhận bù trừ phi tiền mặt',
       'Bù trừ giảm công nợ gốc. Đây KHÔNG phải giao dịch chuyển khoản.',
       '/groups/'||NEW.group_id||'/cycles/'||NEW.cycle_id);
   END IF;
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