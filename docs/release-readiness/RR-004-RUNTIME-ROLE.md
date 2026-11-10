# RR-004 dedicated runtime database role — local verified profile

**Local complete application profile and approved isolated deployed runtime role: PASS. Production/develop roles remain unverified; release NO-GO.** [Managed role and actual protected preview evidence](RR-004-MANAGED-RUNTIME-EVIDENCE.md). This implements and tests a concrete privilege plan without changing shared roles, secrets, Vercel settings or financial activation.

## Implemented boundary

`db/rr004-runtime-policy.mjs` generates grants for a **fresh, dedicated existing LOGIN**. It rejects invalid SQL identifiers and provides a read-only privilege evaluator. No role is provisioned on import and no generic live grant CLI is supplied.

- Runtime must have no superuser, CREATE ROLE/DB, replication, BYPASSRLS or role memberships; no database/public-object ownership, schema CREATE, database CREATE or TEMPORARY privileges; no executable public SECURITY DEFINER functions.
- Explicit table/view inventory, read-only migration history/views, INSERT-only source/allocation/event documents, and only necessary mutable-table operations. No TRUNCATE, TRIGGER or REFERENCES privileges.
- Original obligation UPDATE is limited to `voided_at`; CASH header UPDATE to status/resolution fields; notification UPDATE to `read_at`. Runtime cannot change original obligation or CASH amounts through direct SQL.
- `SELECT FOR UPDATE` requires UPDATE privilege even on immutable documents. For seven locked audit/document tables, only an identifier column is granted; existing immutable triggers reject actual UPDATE. The evaluator now checks all **19** required immutable guards on their correct tables (including migration 024), rejects unexpected UPDATE/INSERT/REFERENCES column grants, and rejects automatic future-object grants. No trigger security was weakened to get application tests passing.

Table-level REVOKE does not erase old column grants. The policy resets its reviewed grants/current-owner default table/sequence grants and the evaluator rejects unexpected legacy column or future-object grants; provision a **fresh** role or separately review/revoke old grants. The policy also revokes PUBLIC schema CREATE and database TEMPORARY, which can affect other clients of a shared database. Applying it outside the disposable environment requires an explicit reviewed role/branch plan.

## Real verification, not SET ROLE simulation

`tests/rr004-runtime-role.integration.mjs` creates a throwaway non-owner LOGIN and connects over TCP using that login. Both `session_user` and `current_user` must be the limited role. It verifies the complete ACL matrix and actual permission denials for schema/temp creation, trigger disabling, audit TRUNCATE/body updates/deletion, money updates and owner role/session impersonation. It also detects an unexpected column grant and a disabled required immutable trigger. The owner restores the trigger in `finally`; the temporary role's grants and role are removed. This test refuses any target other than exact CI/localhost disposable PG17.

The complete application profile uses a **different database owner** (`rr004_owner`) for migrations/fixture setup and the normal exact `test` login as a **non-owner** application runtime. Fixture credentials are synthetic and accepted only by a guard requiring CI, the exact localhost runtime and exact local owner URL plus `RR004_TEST_ONLY=isolated-pg17`. `lib/db/pool.ts` is unchanged and continues to read only `DATABASE_URL`; the server does not use the fixture connection. Financial test flags retain their exact original disposable URL requirements.

`bash scripts/rr004-runtime-local.sh` creates its own loopback-bound PG17, refuses unrelated connection settings, provisions roles, builds on Node 22, runs the full HTTP scenario and optionally all four browsers, executes the original finance audit, rechecks runtime privileges and removes its container/volume on every exit. It fails if source changes during execution. Supply a pinned Playwright module through `RR002_PLAYWRIGHT_ENTRY` to include browser profiles; absence is recorded as zero browser profiles, never a fake matrix PASS.

**Observed:** 001–024 plus idempotent migration PASS; limited-role privilege check PASS before/after; production build PASS; full signed HTTP PASS; Chromium/WebKit desktop + emulated iPhone/Android **4/4 PASS**; independent financial audit **8/8 zero violations**. Private local artifacts: `rr003-artifacts/runtime-role/`. Source digest `359eebf5ac4fab9b87ad80b8fd49f139ee99c5f05780aec1a10633fbb18eaf26`.

## What remains

The original local-only work created no shared/provider role or secret. The owner later separately approved creation of a fresh role on the recovered child and four feature-preview-only env entries; their actual login/ACL/endpoint proof now passes. Production/develop runtime identities still require separately scoped review. Applying this plan needs separate branch/role authorization and a rollback/compatibility review. Table ACLs complement application user/actor authorization; they do not implement per-user RLS or defend against a migration owner deliberately replacing trusted functions/triggers. Keep the migration owner's credentials separate from runtime and review future schema additions/grants explicitly. This profile is not independent human financial/security signoff.


## Runtime endpoint and isolated preview preparation

The source now adds Bearer-protected, read-only `GET /api/internal/settlement-ops/runtime` using the **same pool/login as the application**. It returns privilege blocker codes, fingerprints of current/session roles and the endpoint/database pair, and deployment SHA when supplied by Vercel. It never returns raw role names, database URLs or schema rows. HTTP 200 means the tested ACL profile and same-login check pass; 503 is returned for an owner/unsafe profile or unavailable read. Migration-owner credentials must never be installed in the application environment. This is an authenticated point-in-time attestation, not an independent approval or a replacement for matching schema/migration evidence.

The complete non-owner profile passes this endpoint; the ordinary owner profile is rejected. Missing legacy guards, unexpected column INSERT/REFERENCES/UPDATE grants and automatic default privileges are exercised with real SQL and detected. The new shared inventory module avoids importing migration/CLI filesystem code into the Next server bundle.

[Exact next role/preview package](RR-004-ISOLATED-PREVIEW-PLAN.md) was separately approved and executed; see managed evidence. Before this action, Vercel metadata inspection found no branch-specific feature-preview envs; existing DB/secret entries target production and preview `develop`. No existing values were decrypted/exported. READY feature preview metadata is still from the older remote SHA and cannot certify this endpoint or the candidate's runtime role.
