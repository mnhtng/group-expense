# RR-003 managed Neon historical recovery — 2026-11-09

**Managed historical branch recovery: PASS for the actual sparse RR-001 baseline. Full RR-003 gate: still PENDING / NO-GO.** The owner explicitly approved a Free-only isolated PITR drill from `br-curly-rice-b3xenws6` to a new uniquely named branch, excluding production/development, migrations, paid upgrades and engine activation.

## What actually happened

| Item | Provider-attested result |
|---|---|
| Project / plan | `withered-salad-00928018`, PostgreSQL 17, `free_v3`, history 21600 seconds |
| Source | `br-curly-rice-b3xenws6`, `sc010-rehearsal-20261105`, ready, nondefault/nonprimary |
| Source baseline | One SQL statement, 58 data/schema digests, captured `2026-11-09T12:59:00.890Z`; 23 migrations, 2 original obligations |
| Historical snapshot attempt | HTTP **400**, **not allowed to snapshot non-root branch**; snapshot listing remained empty |
| Successful alternative | Neon Console → source child → Create child branch → **Branch data and schema from a past point in time** |
| New destination | **`br-noisy-river-b3ajidmw`**, `rr003-pitr-20261109-130000` |
| Verified parent | `br-curly-rice-b3xenws6` |
| Actual provider `parent_timestamp` | **`2026-11-09T13:00:31Z`** = **20:00:31 Asia/Ho_Chi_Minh** |
| Provider `parent_lsn` | `0/218E540` |
| Provider created / ready | `13:13:30Z` / `13:13:31Z` |
| First restored digest | `13:14:49.801Z`; all **58/58 equal** to the pre-restore source |
| Source recapture | All **58/58 unchanged** after the operation |
| Independent financial audit | **8/8 zero violations on source AND restored child**, completed by `13:17:54Z` |
| Restored compute | `ep-snowy-art-b3vqd8qc`, direct host pinned by provider metadata, **0.25 → 0.25 CU** |
| Final idle state | Provider reported compute **idle**, suspended at `13:23:02Z`; branch retained for review, no auto-deletion |

The UI displays minute precision and retained seconds `31`; the authoritative recovered point is **13:00:31Z**, not the minute-only branch name or 13:00:00Z. This point is after the baseline capture and about 13 minutes before creation. A historical `parent_timestamp` predating creation, the selected historical-mode UI, the parent receipt and matching data establish a historical fork; this was **not a HEAD clone**. No second branch was created to hide this timestamp detail.

The original snapshot operation could not run on the approved child. The successful operation is **managed historical branching/PITR**, **not snapshot restore**. The Console exposed the timestamp capability absent from the connected `create_branch` tool. It used the same approved project, source, new-destination and Free-only boundaries. No root/production snapshot, source promotion/detachment, reset, swap or shared-data mutation was attempted.

## Reconciliation and privacy

`buildProviderDigestSql` in `db/rr003-restore-compare.mjs` produces one SELECT with one statement snapshot, canonical PostgreSQL text and bounded SHA-256 digests. A real PG17 test proves all connector digests equal the direct-client verifier's 58 digests, including microseconds and numeric JSON values. Imported provider responses must pass project/branch/database/PG-major, table-inventory, class completeness, hash-shape and 10000-row bounds. The connector resolves credentials privately; no DB URL or financial row content was exported.

Checks cover all 51 public tables, canonical live balances and six schema-definition categories. `db/sc007-audit-queries.mjs` contains the unchanged eight independent original-ledger reconciliation queries, now reusable as count-only SELECTs through a credential-private connector. The ordinary SC-007 CLI retains its exact disposable-URL/CI guard; it was **not redirected at Neon**.

Private local receipt, manifests and count-only audits are in ignored `rr003-artifacts/2026-11-09-neon/`, mode 0600 in a 0700 directory. Source and target data were read only. No financial values, names, invoice text or authentication tokens are committed with this evidence. Parent/development/production were not targets of writes; their historical full-row hashes were not newly recaptured by this drill.

## Timing interpretation

- Create-action observation started `13:13:21Z`; provider-ready was `13:13:31Z`: **10 seconds** to observed provider-ready state, including UI overhead.
- First full restored digest completed **88.801 seconds** after that start.
- Independent source/restored finance audit completion was **273 seconds** after that start.
- Recovered state predates the action start by **770 seconds / 12m50s**. **Zero observed baseline row/hash differences** is not a promise of zero RPO under continuing writes. This source was quiescent and sparse.

These are measured **database drill intervals**, not full application/service RTO. There was no declared production incident, restored web deployment, client cutover or independently witnessed service acceptance. The proposed RPO ≤15m / RTO ≤60m policy has **not** been approved or certified.

## Cost, retained resources and limits

The project remained Free before/after creation, four branches within reported limit ten, no plan upgrade or paid feature acceptance. A request to make the new compute's default idle interval explicit returned HTTP **412** (`modifying the suspend interval is not permitted on this account`); no successful timeout change is claimed. Its provider value `0` means use the default, not disable suspension; the later actual idle state confirms suspension occurred. [Neon's API specification documents these timeout semantics](https://github.com/neondatabase/neon-api-python/blob/main/v2.json). The new branch is retained for audit; deleting it requires separate approval.

The recovered source has **zero applied NONCASH, frozen snapshots, disputes and operational runs**. Positive finance preservation remains demonstrated by local PG17 restore fixtures, not by this sparse managed baseline. Snapshot backup, scheduled backups, a separate backup failure domain, positive managed fixtures, external HTTPS alert delivery/acknowledgement, runtime role deployment, accountable finance/security acceptance and full-service RPO/RTO remain unresolved. No migration was included in the PITR authorization; source and restored child remain at 23 until a separate migration decision. Engine OFF and release NO-GO.
