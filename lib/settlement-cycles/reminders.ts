import "server-only";
import {pool} from "@/lib/db/pool";
import {readEngineAccess,readEngineRollout} from "@/lib/settlement-cycles/engine";

const DB="postgresql://test:test@localhost:5432/group_expense";
const testOnly=()=>process.env.CI==="true"&&
  process.env.SC009_TEST_ONLY==="isolated-pg17"&&process.env.DATABASE_URL===DB;
/**
 * SC-009: daily, bounded, uniquely keyed reminders; not a money action.
 * Feature stays OFF for real environments until separate release approval.
 * No timers, external background worker, or user-controlled cron flags.
 */
export async function issueCycleReminders(limit=40){
  if(!Number.isSafeInteger(limit)||limit<1||limit>100)
    throw Error("SC-009 reminder limit invalid.");
  if(!(await readEngineRollout(pool)).enabled&&!testOnly())
    return {disabled:true,candidates:0,attempted:0,inserted:0};
  const c=await pool.connect();
  try{
    await c.query("BEGIN");
    const now=await c.query<{day:string}>("SELECT (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date::text AS day");
    const day=now.rows[0].day;
    type Candidate={recipient:string;groupId:string;cycleId:string;
      ref:string;title:string;body:string};
    const r=await c.query<Candidate>(`
    WITH candidates AS (
      SELECT g.owner_id AS recipient,c.group_id AS "groupId",
        c.id AS "cycleId",('review:'||c.id) AS ref,
        'Kỳ đang chờ khóa sổ' AS title,
        'Chủ nhóm cần rà soát và xác nhận snapshot trước khi tính công nợ.' AS body
      FROM group_settlement_cycles c JOIN groups g ON g.id=c.group_id
      JOIN group_settlement_settings cfg ON cfg.group_id=g.id
      WHERE c.state='review' AND c.reviewed_at<=now()-interval '24 hours'
        AND g.archived_at IS NULL AND cfg.requested_enabled
      UNION ALL
      SELECT v.user_id,p.group_id,p.cycle_id,
        ('proposal:'||p.id||':'||v.user_id),
        'Đề xuất bù trừ đang chờ bạn',
        'Xem nghĩa vụ gốc; chỉ hai người liên quan mới được đồng ý.'
      FROM group_settlement_bilateral_heads h
      JOIN group_settlement_bilateral_proposals p ON p.id=h.current_proposal_id
      JOIN group_settlement_settings cfg ON cfg.group_id=p.group_id
      JOIN groups g ON g.id=p.group_id
      CROSS JOIN LATERAL(VALUES(p.party_low),(p.party_high)) v(user_id)
      WHERE p.created_at<now()-interval '12 hours'
        AND p.created_at>now()-interval '72 hours'
        AND cfg.requested_enabled AND cfg.requested_bilateral_netting
        AND g.archived_at IS NULL
        AND NOT EXISTS(SELECT 1 FROM group_settlement_bilateral_decision_events d
          WHERE d.proposal_id=p.id AND d.event_type='approve' AND d.actor_id=v.user_id)
        AND NOT EXISTS(SELECT 1 FROM group_settlement_bilateral_decision_events d
          WHERE d.proposal_id=p.id AND d.event_type IN('reject','revoke','invalidated','expired'))
        AND NOT EXISTS(SELECT 1 FROM group_settlement_bilateral_applications a
          WHERE a.proposal_id=p.id)
      UNION ALL
      SELECT CASE WHEN s.initiated_by=s.debtor_id THEN s.creditor_id ELSE s.debtor_id END,
        cr.group_id,cr.cycle_id,'cash:'||s.id,
        'Chờ xác nhận thanh toán tiền mặt',
        'Tiền đang chờ xác nhận chưa được tính là đã trả.'
      FROM group_settlement_cycle_repayments cr
      JOIN settlements s ON s.id=cr.settlement_id
      JOIN groups g ON g.id=cr.group_id
      JOIN group_settlement_settings cfg ON cfg.group_id=cr.group_id
      WHERE s.status='pending' AND s.created_at<=now()-interval '24 hours'
        AND g.archived_at IS NULL AND cfg.requested_enabled
      UNION ALL
      SELECT CASE WHEN d.status='open' THEN d.counterparty_id ELSE d.reporter_id END,
        d.group_id,d.cycle_id,'dispute:'||d.id||':'||d.status,
        'Tranh chấp đang chờ phản hồi',
        'Đối chiếu hóa đơn gốc và phản hồi; không xác nhận thay người khác.'
      FROM sc009_dispute_states d
      JOIN groups g ON g.id=d.group_id
      JOIN group_settlement_settings cfg ON cfg.group_id=d.group_id
      WHERE d.status IN('open','awaiting_reporter')
        AND d.created_at<=now()-interval '24 hours'
        AND g.archived_at IS NULL AND cfg.requested_enabled
      UNION ALL
      SELECT g.owner_id,e.group_id,cy.id,'late:'||e.id,
        'Cần đối soát hóa đơn nhập muộn',
        'Hóa đơn phát sinh kỳ đã khóa đang chờ gán vào kỳ rà soát sau.'
      FROM group_settlement_cycles cy
      JOIN group_settlement_cycle_snapshots snap ON snap.cycle_id=cy.id
      JOIN expenses e ON e.group_id=cy.group_id
        AND e.occurred_on>=cy.period_start AND e.occurred_on<cy.period_end
      JOIN groups g ON g.id=cy.group_id
      JOIN group_settlement_settings cfg ON cfg.group_id=cy.group_id
      WHERE cy.state='locked' AND cfg.requested_enabled AND g.archived_at IS NULL
        AND e.deleted_at IS NULL AND e.created_at>snap.cutoff_at
        AND NOT EXISTS(SELECT 1 FROM group_settlement_cycle_snapshot_expenses se
          WHERE se.expense_id=e.id)
        AND NOT EXISTS(SELECT 1 FROM group_settlement_cycle_adjustments adj
          WHERE adj.expense_id=e.id)
    )
    SELECT recipient,"groupId","cycleId",ref,title,body
    FROM candidates
    WHERE $2 OR "groupId" IN(SELECT group_id FROM settlement_cycle_engine_cohort WHERE admitted)
    ORDER BY "groupId","cycleId",ref,recipient
    LIMIT $1`,[limit,testOnly()]);
    await c.query("SELECT id FROM groups WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE",
      [[...new Set(r.rows.map(v=>v.groupId))]]);
    await c.query("SELECT pg_advisory_xact_lock_shared(250025,1)");
    const control=await c.query<{enabled:boolean}>(
      "SELECT enabled FROM settlement_cycle_engine_control WHERE id=1");
    if(!control.rows[0]?.enabled&&!testOnly()){
      await c.query("COMMIT");return {disabled:true,candidates:0,attempted:0,inserted:0};
    }
    let inserted=0;
    for(const v of r.rows){
      if(!testOnly()&&!(await readEngineAccess(c,v.groupId)).financialEngineEnabled)continue;
      const before=await c.query<{n:number}>(`SELECT count(*)::int AS n
        FROM notifications WHERE recipient_id=$1 AND event_key=$2`,
        [v.recipient,`remind:${day}:${v.ref}:${v.recipient}`]);
      await c.query(`SELECT sc009_emit_notice($1,$2,$3,NULL,
        $4,'cycle_reminder',$5,$6,$7)`,[
        v.groupId,v.cycleId,v.recipient,`remind:${day}:${v.ref}:${v.recipient}`,
        v.title,v.body,`/groups/${v.groupId}/cycles/${v.cycleId}`,
      ]);
      if(before.rows[0]?.n===0){
        const after=await c.query<{n:number}>(`SELECT count(*)::int AS n
          FROM notifications WHERE recipient_id=$1 AND event_key=$2`,
          [v.recipient,`remind:${day}:${v.ref}:${v.recipient}`]);
        if(after.rows[0]?.n===1)inserted++;
      }
    }
    await c.query("COMMIT");
    return {disabled:false,candidates:r.rowCount??0,attempted:r.rowCount??0,inserted};
  }catch(e){await c.query("ROLLBACK");throw e;}
  finally{c.release();}
}
