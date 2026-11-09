# RR-005 — Release decision and controlled rollout preparation

**2026-11-09: NO-GO. No staging/production deployment, shared migration, merge or financial activation is authorized.** Technical preparation may continue across readiness tickets under the current owner request; external actions retain their separate approval boundaries.

## Candidate and environment alignment

**Current candidate:** `3739fc644e7a6e75ebcdc262b75703be571385a2`, verified code digest `03757fecd09d8b7ba5ae50375675234738fd16eb32ee4e7e26ddc5770489c181`. [176-unit/12-integration/current-profile evidence](RR-2026-11-09-RUNTIME-ALERT-EVIDENCE.md) and [approved managed-role/protected-preview proof](RR-004-MANAGED-RUNTIME-EVIDENCE.md). The isolated preview has live runtime attestation PASS; production/develop authority is not inferred.

The first verified takeover change set was committed locally as `16fba847df1bab7b2ef9b31dd3e0e582724b2771`. The continuation is verified at code digest `359eebf5ac4fab9b87ad80b8fd49f139ee99c5f05780aec1a10633fbb18eaf26`; [continuation evidence](RR-2026-11-09-CONTINUATION-EVIDENCE.md) records 171 unit/11 integration tests, both complete application/browser profiles, provider recovery and dependency disposition. No local commit has been pushed. The owner subsequently separately approved and received the protected feature preview of `3739fc6…`; no staging/production deployment occurred. `node scripts/rr005-source-evidence.mjs` produces a read-only, credential-free code digest, dirty/untracked status and exact migration SHA-256s; it always reports NO-GO and no independent approval. Record a clean final commit and revalidate any subsequent code changes before release.

| Surface | Verified | Missing |
|---|---|---|
| Local PG17.11 | 001–024, migration idempotency, SQL/HTTP/browser finance regression, logical restore | Independent human acceptance |
| Isolated Neon source `br-curly-rice-b3xenws6` and recovered child `br-noisy-river-b3ajidmw` | Historical PITR 58/58 PASS; source stays 23/unchanged; separate approved 024 on child now 24/24 checksums, 12 guards, eight audits each, repeat idempotent | Positive managed finance fixtures and deployed role/environment parity; no shared migration approval |
| Shared development / production | No mutation performed by this work | Fresh approved drift/credential/runtime-role review; previous migration counts are historical, not newly certified |
| GitHub PR #16 | Open Draft against develop; remote head matches starting checkout | Final reviewed clean SHA, independent finance/security approval |
| Financial activation | Literal OFF; test writes require CI + exact disposable localhost URL + individual flags | Separate reviewed implementation and explicit authorization for any real activation |

## GO/NO-GO gates

| Gate | Current decision |
|---|---|
| RR-001 migration rehearsals | Historical 011–023 PASS; separately approved 024 PASS on recovered child only, 24/24 checksums |
| RR-002 local browser matrix | PASS on local revised source; physical devices/PWA deferred and unverified |
| RR-003 recovery/ops regression | Local regression + managed sparse historical baseline PASS; full-service RPO/RTO and external alert path pending |
| RR-004 agent technical review | Local and approved isolated deployed role/HTTP attestation PASS; production/develop parity, dependency patch review and independent signoff pending |
| RR-005 staging/cohort | NOT AUTHORIZED; no rollout attempted |

Any missing mandatory gate keeps release NO-GO. A group opt-in preference, health HTTP 200 or a successful Cron does not authorize moving money. Test-only flags must be absent from every deployed environment; do not substitute an environment switch for the literal hard-OFF gate.

## Preparation and acceptance sequence

1. Freeze candidate source/migration hashes; reviewers inspect changes and existing financial invariants. Confirm branch, direct/pooled endpoint pairing and least-privilege runtime/migration roles without exporting secrets. Inventory schema definitions, not only `schema_migrations` rows.
2. Review the completed, separately approved [024 rehearsal on recovered child](RR-001-024-NEON-MIGRATION-EVIDENCE.md): exact checksum, expected schema delta, unchanged business data and no-op repeat. That permission does not extend to the original source or shared branches; any staging migration needs its own reviewed target/approval.
3. Review the [executed managed recovery drill](RR-003-MANAGED-PITR-EVIDENCE.md): historical branch receipt, 58-check comparison, independent audits and timing limitations. Obtain separate approval for positive managed finance fixtures and full-service acceptance. Establish RPO/RTO before treating measured database intervals as acceptance. The 6-hour retention window is not RPO; delayed detection can exceed the available history.
4. Independently review the minimatch update and deepmerge local patch; dispose of the remaining low upstream advisory without treating a non-clean registry audit as PASS. Configure one approved external HTTPS monitor with secret-manager Bearer injection. Verify healthy 200, auth denial, controlled 503/transport timeout, delivery, operator acknowledgement, escalation and recovered state. Local test adapters do not certify this path.
5. Obtain independent finance/security signoff and a recorded device-risk decision. A deferral for development does not waive the hardware release gate.
6. Only after those gates, request approval naming the exact **staging** deployment/source SHA, database branch and migration list, monitor host, synthetic test scope, cost and rollback target. No staging command is executed by this document.
7. A future separately reviewed production activation change must implement enforced explicit group cohort selection. Roll out opted-in groups **1 → 5 → 25**, each stage requiring a complete observed settlement period, zero conservation violations, no unexplained pending/reservation/dispute state and completed incident response. No automated enrollment or expansion is prepared here.

## Rollback and recovery

- On any conservation mismatch, duplicate discharge, pair privacy failure, unverified source drift or loss of recovery evidence: stop expansion and new financial operations; preserve original records and read-only evidence. Keep engine OFF for the current candidate.
- Application rollback targets a previously tested deployment compatible with the installed forward schema. Rehearse that compatibility on synthetic staging before approving rollout. No rollback rehearsal on a live deployment is claimed.
- Never reverse applied NONCASH, mark pending CASH confirmed, alter an immutable source/audit event, delete migration history or restore over production to force balances to match.
- Restore to a new independent branch first. Reconcile original sources, confirmed/pending CASH, NONCASH direction equality, snapshot/signature/dispute/audit history and operational queues. Restored jobs/notifications can be replayed; review downstream delivery duplication and invalidated sessions before connecting any external sink. Matching database hashes alone does not prove service-level RTO or absence of duplicate push delivery.
- A real production restore/swap, data-loss decision, corrective signed financial event or schema privilege change requires the accountable owner's specific approval.

## Original approved provider package — executed with documented provider fallback

The owner approved this Free-only scope. Historical snapshot creation failed with HTTP 400 because the source is a non-root branch. The same approved source was instead recovered through Console historical branching to **`br-noisy-river-b3ajidmw`**, with actual point **`2026-11-09T13:00:31Z`**. At pre-024 capture, source/restored data and schema matched 58/58; source was unchanged; both passed 8/8 audits. [Full receipt and limits](RR-003-MANAGED-PITR-EVIDENCE.md). No snapshot was created, so its proposed 24-hour expiry does not apply to the retained recovered branch. No plan upgrade, migration or activation was performed during PITR. The owner subsequently separately approved 024 on the recovered child, and that isolated rehearsal now passes; see the linked 024 evidence. The original procedure below is retained for review; it is not a command to retry on production/root.

Project `withered-salad-00928018`; source **only** `br-curly-rice-b3xenws6`; excluded `br-round-salad-b39y4yce` and `br-dry-poetry-b31cudmb`. Proposed snapshot name `rr003-historical-<UTC>` and new restore name `rr003-pitr-<UTC>`; no existing destination ID, no branch/name/compute swap, promotion, source migration or deletion.

After approval: capture the 58-check source baseline, choose/record a UTC point immediately after that capture while the source is quiescent, wait at least 60 seconds, recheck that point against the live 6-hour retention, call `create_snapshot` with that historical timestamp (24h snapshot expiry), then restore its returned ID into the new unique branch. Re-attest provider lineage/compute, compare the restored data and source again, measure provider duration separately from full-service RTO, preserve receipts for review. Branch compute/storage may consume allowance or incur cost; owner must approve the provider-reported cost/limit before creation, with no plan upgrade. Snapshot support on Free is not presumed from tool availability.

Owner-approved policy (2026-11-09): **RPO ≤15 minutes, service RTO ≤60 minutes**. These are accepted targets, not guarantees or verified compliance. The existing source has sparse finance fixtures; this first drill would prove preservation of its actual data only. Positive NONCASH/dispute fixtures on managed Neon need a separately authorized synthetic branch and are not created on the RR-001 source.

The owner selected email, supplied the private recipient address and confirmed receipt/reading of the one-off Gmail drill. Use operator alias `release-owner`. Automatic hosted mail delivery, scheduling, protected HTTPS target and full-service recovery acceptance still require configuration/evidence; independent signatures remain pending. See [alert delivery evidence](RR-003-ALERT-DELIVERY.md) and the [concrete isolated role/preview approval package](RR-004-ISOLATED-PREVIEW-PLAN.md).

## Read-only Vercel deployment metadata — 2026-11-09

Connected project `group-expense` (`prj_pBD9UtMAhNGFWh7Qmzskq90lVSC7`) reports Next.js with **Node 22.x**. Latest automatic feature preview `dpl_DFXJ2BY8UBQRNSUYUyedoECjGfdw` is READY, target null, `sin1`, source `41bc3ae39e90d103242f05372902be457aa88209`. The listed READY production deployment `dpl_6vc1vcdtSJr2AUMVGRNzRPdWHkM4` is from **main** at `b0c7e0ec6af450975e4e5d2f2752a150953130fa`. Neither historical deployment contains the current local candidate. The later separately approved preview `dpl_EqHn5GRrhCK3HfvcSojhkAnYhgJq` is READY at `3739fc6…`; [managed runtime evidence](RR-004-MANAGED-RUNTIME-EVIDENCE.md) supersedes the older feature-preview observation. READY describes provider build metadata, not a successful protected HTTP/finance/restore acceptance test.

Project metadata reports SSO deployment protection enabled for `all_except_custom_domains`. An external monitor of an isolated protected preview must have separately approved machine access in addition to the application's Cron Bearer secret. Do not disable protection or put bypass credentials in URLs/logs to make a probe pass. At that initial inspection, no deployment/secret setting was changed and no remote HTTP probe occurred. The subsequent owner-approved child-only role and feature-preview action added four scoped secrets, deployed the reviewed candidate and verified protected runtime/status GETs. All 16 pre-existing env metadata entries and SSO remained unchanged; no existing values were exported and no Cron replay was performed. Production/develop DB identity and schema remain unverified to this candidate. The provider's minimal metadata response does not attest all build/install/Cron configuration.
