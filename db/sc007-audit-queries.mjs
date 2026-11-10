/** Independent ledger reconciliation SQL. Safe to reuse via a credential-private
 * provider connector; callers own environment authorization and READ ONLY scope.
 * These queries are unchanged from the SC-007 disposable auditor.
 */
const scopeSql=`
  WITH cash AS (
    SELECT sa.obligation_id,
      COALESCE(sum(sa.amount_minor) FILTER(WHERE s.status='confirmed'),0)
        AS confirmed,
      COALESCE(sum(sa.amount_minor) FILTER(WHERE s.status='pending'),0)
        AS pending
    FROM settlement_allocations sa
    JOIN settlements s ON s.id=sa.settlement_id AND s.group_id=sa.group_id
    GROUP BY sa.obligation_id
  ), noncash AS (
    SELECT a.obligation_id,COALESCE(sum(a.amount_minor),0) AS confirmed
    FROM group_settlement_bilateral_application_allocations a
    JOIN group_settlement_bilateral_applications p ON p.id=a.application_id
      AND p.group_id=a.group_id
    GROUP BY a.obligation_id
  )
  SELECT o.id,o.group_id,o.amount_minor::numeric AS original,
    COALESCE(c.confirmed,0) AS confirmed_cash,
    COALESCE(c.pending,0) AS pending_cash,
    COALESCE(n.confirmed,0) AS confirmed_noncash,
    b.original_minor AS view_original,
    b.confirmed_cash_minor AS view_cash,
    b.pending_cash_minor AS view_pending,
    b.confirmed_setoff_minor AS view_noncash,
    b.outstanding_minor AS view_outstanding,
    b.available_minor AS view_available
  FROM obligations o
  JOIN bn005_obligation_balances b ON b.obligation_id=o.id
  LEFT JOIN cash c ON c.obligation_id=o.id
  LEFT JOIN noncash n ON n.obligation_id=o.id
`;
export const FINANCIAL_AUDIT_QUERIES=Object.freeze([
  ["exact_live_balance_independent_ledger",`
      SELECT id FROM (${scopeSql}) x WHERE
        original<=0 OR confirmed_cash<0 OR confirmed_noncash<0
        OR pending_cash<0 OR
        confirmed_cash+confirmed_noncash+pending_cash>original
        OR original<>view_original
        OR confirmed_cash<>view_cash
        OR confirmed_noncash<>view_noncash
        OR pending_cash<>view_pending
        OR original-confirmed_cash-confirmed_noncash<>view_outstanding
        OR original-confirmed_cash-confirmed_noncash-pending_cash<>view_available
        OR view_available<0 OR view_outstanding<0`],
  ["exact_cash_allocations_equal_settlement",`
      SELECT s.id,s.amount_minor::text AS total,
        COALESCE(sum(a.amount_minor),0)::text AS allocated,
        count(a.obligation_id)::int AS count
      FROM settlements s
      LEFT JOIN settlement_allocations a ON a.settlement_id=s.id
      GROUP BY s.id HAVING COALESCE(sum(a.amount_minor),0)<>s.amount_minor
        OR count(a.obligation_id)=0
    `],
  ["bn004_pair_conservation_and_source_identity",`
      SELECT app.id,app.offset_minor::text AS offset,
        COALESCE(sum(al.amount_minor) FILTER(WHERE
          al.debtor_id=app.party_low AND al.creditor_id=app.party_high),0)::text AS a,
        COALESCE(sum(al.amount_minor) FILTER(WHERE
          al.debtor_id=app.party_high AND al.creditor_id=app.party_low),0)::text AS b
      FROM group_settlement_bilateral_applications app
      LEFT JOIN group_settlement_bilateral_application_allocations al
        ON al.application_id=app.id
      GROUP BY app.id
      HAVING COALESCE(sum(al.amount_minor) FILTER(WHERE
          al.debtor_id=app.party_low AND al.creditor_id=app.party_high),0)
          <>app.offset_minor
        OR COALESCE(sum(al.amount_minor) FILTER(WHERE
          al.debtor_id=app.party_high AND al.creditor_id=app.party_low),0)
          <>app.offset_minor
        OR count(al.obligation_id)<>(
          SELECT count(*) FROM group_settlement_bilateral_sources src
          WHERE src.proposal_id=app.proposal_id AND src.proposed_minor>0)
        OR count(al.obligation_id)<>count(DISTINCT al.obligation_id)`],
  ["bn004_source_exact_original_allocation",`
      SELECT al.application_id,al.obligation_id FROM
        group_settlement_bilateral_application_allocations al
      JOIN group_settlement_bilateral_applications app
        ON app.id=al.application_id
      LEFT JOIN group_settlement_bilateral_sources src
        ON src.proposal_id=app.proposal_id AND src.obligation_id=al.obligation_id
      LEFT JOIN obligations o ON o.id=al.obligation_id
      WHERE src.obligation_id IS NULL OR o.id IS NULL
        OR al.amount_minor<>src.proposed_minor
        OR al.debtor_id<>o.debtor_id OR al.creditor_id<>o.creditor_id
        OR al.group_id<>o.group_id OR app.group_id<>o.group_id
        OR al.cycle_id<>app.cycle_id`],
  ["bn006_cash_provenance_and_no_fake_discharge",`
      SELECT r.settlement_id,r.application_id FROM
        group_settlement_bilateral_residual_repayments r
      LEFT JOIN settlements s ON s.id=r.settlement_id
      LEFT JOIN group_settlement_cycle_repayments cr ON cr.settlement_id=r.settlement_id
      LEFT JOIN group_settlement_bilateral_applications a ON a.id=r.application_id
      WHERE s.id IS NULL OR cr.settlement_id IS NULL OR a.id IS NULL
        OR r.amount_minor<>s.amount_minor OR r.amount_minor<>cr.amount_minor
        OR r.group_id<>s.group_id OR r.cycle_id<>a.cycle_id
        OR r.group_id<>a.group_id OR r.cycle_id<>cr.cycle_id
        OR r.debtor_id<>s.debtor_id OR r.creditor_id<>s.creditor_id
        OR NOT (
          (r.debtor_id=a.party_low AND r.creditor_id=a.party_high)
          OR (r.debtor_id=a.party_high AND r.creditor_id=a.party_low)
        ) OR r.allocation_count<>(
          SELECT count(*) FROM settlement_allocations sa
          WHERE sa.settlement_id=s.id)`],
  ["sc006_historic_source_single_orig_attribution",`
      SELECT adj.id,adj.expense_id FROM group_settlement_cycle_adjustments adj
      JOIN group_settlement_cycles origin ON origin.id=adj.origin_cycle_id
      JOIN group_settlement_cycles target ON target.id=adj.target_cycle_id
      JOIN expenses e ON e.id=adj.expense_id
      WHERE origin.state<>'locked' OR target.state NOT IN('review','locked')
        OR e.group_id<>adj.group_id OR target.group_id<>adj.group_id
        OR e.occurred_on<origin.period_start OR e.occurred_on>=origin.period_end
        OR e.version<>adj.expense_version AND NOT(
          e.version=adj.expense_version+1 AND e.completed_at IS NOT NULL
          AND e.completed_by=e.created_by)
        OR EXISTS(SELECT 1 FROM group_settlement_cycle_snapshot_expenses se
          WHERE se.expense_id=e.id AND se.cycle_id=adj.origin_cycle_id)
        OR (target.state='locked' AND NOT EXISTS(
          SELECT 1 FROM group_settlement_cycle_snapshot_expenses se
          WHERE se.expense_id=e.id AND se.cycle_id=adj.target_cycle_id))`],
  ["snapshot_original_obligation_unique_source",`
      SELECT obligation_id FROM group_settlement_cycle_snapshot_obligations
      GROUP BY obligation_id HAVING count(*)<>1`],
  ["recurring_rule_period_unique",`
      SELECT rule_id,period FROM recurring_expense_occurrences
      GROUP BY rule_id,period HAVING count(*)<>1`],
 ]);
export function providerFinancialAuditSql(){
  return FINANCIAL_AUDIT_QUERIES.map(([name,sql])=>
    "SELECT '"+name+"' AS check_name,count(*)::int AS violations FROM ("+sql+") audit"
  ).join("\nUNION ALL\n");
}
