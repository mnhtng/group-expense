# Migration 024 — approved isolated Neon rehearsal, 2026-11-09

**PASS on the recovered child only. Release remains NO-GO.** The owner separately approved applying **only `024_legacy_audit_immutability.sql`** to PITR child `br-noisy-river-b3ajidmw`. This does not expand the preceding PITR approval or authorize source/development/production migrations, role grants, deployment or engine activation.

## Target and exact operation

| Check | Observed result |
|---|---|
| Project | `withered-salad-00928018`, PostgreSQL 17, `free_v3` |
| Target | `br-noisy-river-b3ajidmw`, `rr003-pitr-20261109-130000`, nondefault/nonprimary, ready |
| Parent/source | `br-curly-rice-b3xenws6`, excluded from writes |
| Target compute | `ep-snowy-art-b3vqd8qc`, branch-pinned private connector |
| Migration SHA-256 | `cc1bb676a91425fccb0b865ffd6fd33484675920d26d8bf54f2c449d1903b08e` |
| Candidate | Local commit `041065b27b77634e8e7f5cbff640d50f707c083e`; verified code digest `359eebf5ac4fab9b87ad80b8fd49f139ee99c5f05780aec1a10633fbb18eaf26` |
| Fresh target baseline | `2026-11-09T13:46:48.371Z`, 23 migrations, all 58 checks equal the source |
| Apply request/response | Started `13:48:48Z`, successful response by `13:48:57Z` (**20:48:57 Asia/Ho_Chi_Minh**) |
| Installed versions | **24/24 checksums match exact local migration sources**; no 001–023 SQL reapplied |
| New protection | **One function + 12 enabled triggers** across six legacy audit tables |
| Independent audits | **8/8 zero violations on target and source** |
| Idempotent repeat | Successful no-op; all **58/58 post-migration digests unchanged**, captured `13:50:54.680Z` |

The exact repository SQL was executed through a credential-private, branch/compute-pinned connector transaction, **not the `pnpm db:migrate` CLI**. The package took the migrator's transaction advisory lock `(240011,2026)`, locked the migration log and six target audit tables, checked database/PG major, compared all 23 prior migration names/checksums, and rechecked all 58 baseline digests before applying 024 and inserting its checksum in the same transaction. Local lock/statement timeout settings bounded the connector transaction. On repeat, matching installed checksum causes a no-op before any DDL or migration-log INSERT.

The wrapper was tested first on disposable PG17: wrong baseline refuses without applying 024; a matching local baseline applies it; repeat preserves every digest. The managed post-migration function/trigger definition hashes exactly match that local migration result. These are additional checks around the unchanged versioned SQL, not a new general-purpose live migration command.

## Preservation and schema differences

**55/58 target digest classes are unchanged.** Only `schema_versions`, `schema_functions` and `schema_triggers` changed, exactly as expected. This preserves all 51 business-data/live-balance classes and four unaffected schema categories. No financial/audit UPDATE, DELETE, TRUNCATE or synthetic financial INSERT was executed on Neon. The only row INSERT was the authorized migration-history record.

The six protected tables are `expense_events`, `expense_completion_events`, `settlement_events`, `group_membership_events`, `group_note_events` and `group_settlement_config_events`. Each has an enabled UPDATE/DELETE guard and statement-level TRUNCATE guard. Existing local tests exercise all 18 denied operations and the full restricted-runtime application profile; no destructive DML probe or temporary fixture was introduced into this managed branch.

**Source remains at 23 migrations, with all 58 source digests unchanged before/after.** Development/production were not targets of SQL writes, role changes, reset, promotion or deployment. Their entire data/schema state was not newly re-attested by this child-only operation.

The [original PITR 58/58 equality](RR-003-MANAGED-PITR-EVIDENCE.md) remains valid at its captured pre-024 time. After this deliberately authorized schema change, target/source full-schema equality is no longer expected; do not replace that historical receipt with a false current 58/58 equality claim. The source's sparse finance baseline still does not certify positive managed NONCASH/dispute fixtures or service RPO/RTO.

## Evidence and remaining gates

Private mode-0600 receipts, manifests, count-only audits, approved SQL and local wrapper results are retained in ignored mode-0700 `rr003-artifacts/2026-11-09-neon-024/`. No password, connection URL or financial row content was exported. No plan upgrade or new resource was created; compute uses its existing Free default idle policy.

This closes **isolated managed rehearsal of migration 024**, not production readiness. Deployed runtime-role proof, external monitoring/acknowledgement, service RPO/RTO, positive managed finance coverage, physical device/PWA acceptance, dependency patch review, accountable security/finance signatures and staging/production authorization remain pending. Engine OFF; PR #16 Draft; no push/deploy/merge.
