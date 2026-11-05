# Release Readiness — gated verification backlog

**Feature branch:** `feat/settlement-cycles-bilateral` → Draft PR #16 against `develop`.
**Scope:** verification and operational assurance **after** SC-010, not new settlement features.
**Release status:** **NO-GO**. `SETTLEMENT_CYCLE_ENGINE_READY=false` is immutable for this track.
**Protocol:** one RR ticket per conversation; collect evidence against the exact commit SHA before changing the next gate.

## Existing implementation

SC-001–SC-010 and BN-001–BN-006 are implemented on the feature branch. PostgreSQL 17 disposable CI, HTTP tests, original-ledger audits and SC-010 logical restore pass. They do **not** establish managed Neon restore capability, real-device correctness or permission to release financial changes.

## Backlog and gates

| Ticket | Priority | Goal | Exit criterion | Status |
|---|---|---|---|---|
| **RR-001** | P0 | Isolated Neon migration 011–023 rehearsal | Confirm exact isolated child and credential endpoints; record pre-migration source hashes; separately authorize 011–023 *on that child alone*; migrate twice with checksum equality; revalidate original balances, source provenance, privacy and parent immutability | **PARTIAL — read-only preflight and connection guard; migration NOT authorized/executed** |
| **RR-002** | P0 | Browser and mobile real-interaction E2E | Chromium + WebKit, iOS installed PWA and Android; consent, focus, stale proposal, error, offline, deep links, bilateral privacy and 44px touch; artifacts and regression list | NOT STARTED |
| **RR-003** | P0 | Recoverability and operations alerting | Authorized provider backup/PITR restore into new independent Neon branch; independent immutable-source reconciliation, declared RPO/RTO, verified authenticated 503/alert response path, operator acknowledgement | NOT STARTED |
| **RR-004** | P0 | Independent security and finance signoff | Full original + confirmed CASH + NONCASH + pending conservation, source-link accuracy, disputed-source denials, roles, concurrency, secrets, threats and documented review by accountable humans | NOT STARTED |
| **RR-005** | P1 | Staging and staged-release decision | Only after RR-001..004 pass, separate explicit approval for staging migrations/deployment and production release; test rollback without ledger reversal; reviewed commit SHA; controlled opted-in 1→5→25 cohort | BLOCKED / NOT AUTHORIZED |

## Non-negotiable constraints

1. **No changes to original obligation ledger, CASH/NONCASH allocations or immutable snapshots in readiness tooling.** No synthetic bank transfer.
2. **No ORM.** Keep PostgreSQL through the existing `pg` driver and versioned SQL migrations.
3. No automatic merge, staging or production deployment, shared-Neon schema change, feature flag activation or project-wide secret export.
4. The SC-010 disposable PG17 restore script is **never** run on Neon.
5. Financial data reads must be isolated and role-limited. Do not log credentials, member identities, invoice descriptions or payment amounts in operational telemetry.
6. An isolated Neon schema write requires a **separate explicit authorization identifying RR-001 migrations 011–023 and branch ID**; generic "continue" is not enough.
7. Do not claim release-ready from a green CI or a read-only Neon baseline. Each gate needs independent evidence and human signoff.
8. The SC-010 runbook remains canonical for recovery and staged rollout: [SC-010](../settlement-cycles/SC-010-OPERATIONS-ROLLOUT.md).

## Current RR-001 evidence (read-only, 2026-11-05)

- Neon project: `withered-salad-00928018` (`group-expense`).
- Isolated child: `br-curly-rice-b3xenws6` (`sc010-rehearsal-20261105`).
- Parent: `br-dry-poetry-b31cudmb` (`development`).
- Production: `br-round-salad-b39y4yce` (**excluded**).
- Child and parent both have **10** installed migrations, ending at `010_monthly_recurring_expenses.sql`; independent Neon compare reports **empty schema diff**.
- Baseline child: **2** original expenses, **2** obligations. Values and identity-bearing rows are deliberately not published in repository docs.
- The child PostgreSQL 17 compute was found; endpoint host pair is pinned to that **one** child in `db/rr001-neon-preflight.mjs`. The checker rejects all other project, branch, database, host, role or TLS combinations before connecting.
- **No migration 011–023 has been executed on Neon by RR-001.** This evidence is only preflight, not completion.
- The existing engine remains OFF; PR #16 must remain Draft.

## RR-001 reproducibility and handoff

- Unit validation: `node --test tests/rr001-neon-preflight.test.mjs`.
- Operator read-only DB preflight, only after securely provisioning branch-specific `DATABASE_URL`, `DATABASE_URL_DIRECT`, `RR001_PROJECT_ID` and `RR001_BRANCH_ID`: `node db/rr001-neon-preflight.mjs`.
- Without those values it fails closed and cannot connect. Passwords and URLs must **never** enter Git.
- Do not run `pnpm db:migrate` or any Neon schema-mutating tool until the separately authorized RR-001 migration rehearsal. At that point, re-verify branch metadata and direct/pool endpoints; run the exact migrations twice and post-migration source/parent audit.
- RR-002..005 are deliberately **not implemented** under RR-001.
