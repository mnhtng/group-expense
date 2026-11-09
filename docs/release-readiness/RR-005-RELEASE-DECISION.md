# RR-005 — Release decision and controlled rollout preparation

**2026-11-09: NO-GO. No staging/production deployment, shared migration, merge or financial activation is authorized.** Technical preparation may continue across readiness tickets under the current owner request; external actions retain their separate approval boundaries.

## Candidate and environment alignment

The local candidate extends feature HEAD `41bc3ae39e90d103242f05372902be457aa88209` with uncommitted code and migration 024. It cannot be represented as a clean reviewed commit. `node scripts/rr005-source-evidence.mjs` produces a read-only, credential-free code digest, dirty/untracked status and exact migration SHA-256s; it always reports NO-GO and no independent approval. Record a clean final commit and revalidate any subsequent code changes before release.

| Surface | Verified | Missing |
|---|---|---|
| Local PG17.11 | 001–024, migration idempotency, SQL/HTTP/browser finance regression, logical restore | Independent human acceptance |
| Isolated Neon `br-curly-rice-b3xenws6` | Read-only 23 installed migrations on 2026-11-09; historical RR-001 evidence retained | Approval + isolated rehearsal for 024, restored provider branch, exact reviewed-source parity |
| Shared development / production | No mutation performed by this work | Fresh approved drift/credential/runtime-role review; previous migration counts are historical, not newly certified |
| GitHub PR #16 | Open Draft against develop; remote head matches starting checkout | Final reviewed clean SHA, independent finance/security approval |
| Financial activation | Literal OFF; test writes require CI + exact disposable localhost URL + individual flags | Separate reviewed implementation and explicit authorization for any real activation |

## GO/NO-GO gates

| Gate | Current decision |
|---|---|
| RR-001 historical 011–023 rehearsal | Historical SCHEMA PASS only; 024 pending |
| RR-002 local browser matrix | PASS on local revised source; physical devices/PWA deferred and unverified |
| RR-003 local recovery/ops regression | PASS locally; managed recovery/alert gate pending |
| RR-004 agent technical review | Findings fixed/tested locally; independent signoff and runtime role proof pending |
| RR-005 staging/cohort | NOT AUTHORIZED; no rollout attempted |

Any missing mandatory gate keeps release NO-GO. A group opt-in preference, health HTTP 200 or a successful Cron does not authorize moving money. Test-only flags must be absent from every deployed environment; do not substitute an environment switch for the literal hard-OFF gate.

## Preparation and acceptance sequence

1. Freeze candidate source/migration hashes; reviewers inspect changes and existing financial invariants. Confirm branch, direct/pooled endpoint pairing and least-privilege runtime/migration roles without exporting secrets. Inventory schema definitions, not only `schema_migrations` rows.
2. Obtain separate approval to rehearse **024 only on a specifically identified isolated child**, with baseline hashes and forward-only recovery. Existing RR-001 permission for 011–023 is not reusable permission for 024 or shared branches.
3. Execute the [managed recovery drill](RR-003-RECOVERY-DRILL.md): approved source/new destination, historical snapshot receipt, no source writes during baseline/restore point, full comparison, timings and human review. Establish RPO/RTO before treating measured times as acceptance. The 6-hour retention window is not RPO; delayed detection can exceed the available history.
4. Resolve or explicitly review/accept the two tooling dependency advisories recorded in RR-004, without treating a non-clean audit as PASS. Configure one approved external HTTPS monitor with secret-manager Bearer injection. Verify healthy 200, auth denial, controlled 503/transport timeout, delivery, operator acknowledgement, escalation and recovered state. Local test adapters do not certify this path.
5. Obtain independent finance/security signoff and a recorded device-risk decision. A deferral for development does not waive the hardware release gate.
6. Only after those gates, request approval naming the exact **staging** deployment/source SHA, database branch and migration list, monitor host, synthetic test scope, cost and rollback target. No staging command is executed by this document.
7. A future separately reviewed production activation change must implement enforced explicit group cohort selection. Roll out opted-in groups **1 → 5 → 25**, each stage requiring a complete observed settlement period, zero conservation violations, no unexplained pending/reservation/dispute state and completed incident response. No automated enrollment or expansion is prepared here.

## Rollback and recovery

- On any conservation mismatch, duplicate discharge, pair privacy failure, unverified source drift or loss of recovery evidence: stop expansion and new financial operations; preserve original records and read-only evidence. Keep engine OFF for the current candidate.
- Application rollback targets a previously tested deployment compatible with the installed forward schema. Rehearse that compatibility on synthetic staging before approving rollout. No rollback rehearsal on a live deployment is claimed.
- Never reverse applied NONCASH, mark pending CASH confirmed, alter an immutable source/audit event, delete migration history or restore over production to force balances to match.
- Restore to a new independent branch first. Reconcile original sources, confirmed/pending CASH, NONCASH direction equality, snapshot/signature/dispute/audit history and operational queues. Restored jobs/notifications can be replayed; review downstream delivery duplication and invalidated sessions before connecting any external sink. Matching database hashes alone does not prove service-level RTO or absence of duplicate push delivery.
- A real production restore/swap, data-loss decision, corrective signed financial event or schema privilege change requires the accountable owner's specific approval.

## Concrete next provider approval package — not executed

Project `withered-salad-00928018`; source **only** `br-curly-rice-b3xenws6`; excluded `br-round-salad-b39y4yce` and `br-dry-poetry-b31cudmb`. Proposed snapshot name `rr003-historical-<UTC>` and new restore name `rr003-pitr-<UTC>`; no existing destination ID, no branch/name/compute swap, promotion, source migration or deletion.

After approval: capture the 58-check source baseline, choose/record a UTC point immediately after that capture while the source is quiescent, wait at least 60 seconds, recheck that point against the live 6-hour retention, call `create_snapshot` with that historical timestamp (24h snapshot expiry), then restore its returned ID into the new unique branch. Re-attest provider lineage/compute, compare the restored data and source again, measure provider duration separately from full-service RTO, preserve receipts for review. Branch compute/storage may consume allowance or incur cost; owner must approve the provider-reported cost/limit before creation, with no plan upgrade. Snapshot support on Free is not presumed from tool availability.

Proposed policy for discussion: **RPO ≤15 minutes, RTO ≤60 minutes**. These are unapproved targets, not guarantees. The existing source has sparse finance fixtures; this first drill would prove preservation of its actual data only. Positive NONCASH/dispute fixtures on managed Neon need a separately authorized synthetic branch and are not created on the RR-001 source.

External monitoring still needs an approved isolated HTTPS origin, delivery destination and named acknowledging operator. These choices and independent signatures are the outstanding owner inputs; routine source/test changes do not require individual confirmations.

## Read-only Vercel deployment metadata — 2026-11-09

Connected project `group-expense` (`prj_pBD9UtMAhNGFWh7Qmzskq90lVSC7`) reports Next.js with **Node 22.x**. Latest automatic feature preview `dpl_DFXJ2BY8UBQRNSUYUyedoECjGfdw` is READY, target null, `sin1`, source `41bc3ae39e90d103242f05372902be457aa88209`. The listed READY production deployment `dpl_6vc1vcdtSJr2AUMVGRNzRPdWHkM4` is from **main** at `b0c7e0ec6af450975e4e5d2f2752a150953130fa`. Neither contains the current uncommitted candidate. READY describes provider build metadata, not a successful protected HTTP/finance/restore acceptance test.

Project metadata reports SSO deployment protection enabled for `all_except_custom_domains`. An external monitor of an isolated protected preview must have separately approved machine access in addition to the application's Cron Bearer secret. Do not disable protection or put bypass credentials in URLs/logs to make a probe pass. No deployment, alias, protection, environment value or secret was changed/exported; no remote HTTP probe or preview Cron replay was performed. Runtime DB identity, secret targets and actual production schema remain unverified. The provider's minimal metadata response does not attest all build/install/Cron configuration.
