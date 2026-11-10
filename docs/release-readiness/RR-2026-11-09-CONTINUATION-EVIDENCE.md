# Readiness continuation — committed baseline, managed PITR and runtime isolation

**2026-11-09: local implementation/verification PASS; overall release NO-GO.** Owner requested continuation and separately approved a Free-only isolated provider PITR operation. The first verified readiness change set was committed locally as **`16fba847df1bab7b2ef9b31dd3e0e582724b2771`**; its code digest exactly matched the preceding 163-unit/10-integration/full-browser/restore evidence. No push/merge/deploy occurred.

## New verified work

| Scope | Actual result |
|---|---|
| Node 22 unit suite | **171/171 PASS**, including provider digest import, real consumer dependency regressions and runtime privilege policy/fixture guards |
| PG17 integration | **11/11 PASS**, including 16 two-session allocation races, direct-vs-provider canonical hash equality and a real non-owner LOGIN boundary |
| Standard owner profile | Production build, signed HTTP, four browser profiles, before/after independent financial audits and logical restore **PASS** |
| Restricted application profile | Different migration/fixture owner, genuine limited application LOGIN: build, signed HTTP, four browsers, 8 independent audits and privilege recheck **PASS** |
| Managed historical recovery | New child `br-noisy-river-b3ajidmw`, historical `parent_timestamp`, **58/58 source/restore matches**, **58 source hashes unchanged**, **8/8 zero violations on each branch** |
| Dependency scan | **0 moderate/high/critical; 1 low remains reported by registry**. Exit 1 retained, no ignore/suppression |
| CLI / lint / diff | Real shadcn help invocation PASS; ESLint **0 errors, 1 pre-existing unused-import warning**; source diff whitespace check PASS (patch context excluded) |

New verified code digest: **`359eebf5ac4fab9b87ad80b8fd49f139ee99c5f05780aec1a10633fbb18eaf26`**. The runtime runner recorded the same digest before/after; the fingerprint now includes dependency `.patch` files. The suites use Node **22.23.4**, PG **17.11**, Playwright **1.64.1**. Existing financial hard-OFF and test-only URL/flag guards are unchanged. Final review also tightened the privilege evaluator to reject missing/null administrative metadata; its negative regression and the complete profiles were rerun on this final digest. An initial final-round shell wrapper omitted SC007_TEST_ONLY for the post-browser audit and was correctly refused; the wrapper was corrected without changing the auditor or its guards, and only the subsequent complete pass is counted.

See [managed PITR evidence and exact timing limits](RR-003-MANAGED-PITR-EVIDENCE.md) and [runtime role implementation/verification](RR-004-RUNTIME-ROLE.md). Provider recovery preserves the source's actual sparse data, not positive managed NONCASH/dispute fixtures or a full service cutover. No migration, role grant, synthetic finance seeding or financial activation was performed on Neon under the PITR authorization.

## Dependency remediation and remaining advisory

The existing `deepmerge@4.3.1` defect was reproduced: a JSON target with an own `__proto__` property poisoned the returned object's prototype. The reviewed patch replaces destination assignment with own data-property definition in the source, CJS and UMD entry files, preserving normal merge/custom-merge/symbol/array behavior. Locked pnpm patched-dependency metadata applies the patch reproducibly; tests exercise target/source/nested malicious cases and normal consumers. This mitigates the reproduced returned-prototype defect; it is not a sanitizer guarantee for arbitrary downstream libraries or custom callbacks.

`minimatch` versions in the affected >=7/<11.0.1 range are overridden to the advisory-patched **11.0.1**. Regression uses the actual `@ts-morph/common` resolution plus real ts-morph source discovery, extglobs and brace patterns; both complete application/browser profiles pass. Existing unaffected 3.x consumers retain their API/version. No forced application feature or ORM change was introduced.

Production scan of the resulting locked graph (329 dependencies) reports **one low deepmerge upstream advisory**, no moderate/high/critical. The upstream package version still has no official patched release, so the local patch does **not** make the registry audit clean. The unresolved approval item is independent review/acceptance of the local patch or adoption of a future supported upstream fix; no advisory was ignored, hidden by changing dependency classification or falsely marked absent. Sources: [deepmerge advisory](https://github.com/advisories/GHSA-gcqx-w48m-w2h4), [minimatch advisory](https://github.com/advisories/GHSA-g3hv-75wg-m249).

## Remaining boundaries

Managed source/restore initially had 23 migrations; local source has 024. The owner subsequently granted the separate child-only approval, and [024 managed rehearsal](RR-001-024-NEON-MIGRATION-EVIDENCE.md) now PASSES: recovered child 24/24 checksums, 12 enabled guards, business data unchanged, repeat a 58/58 no-op. Original source remains 23 and unchanged; no shared migration was authorized. Deployed runtime credential/ACL proof, external HTTPS monitoring delivery/acknowledgement, approved and service-verified RPO/RTO, positive managed finance fixtures, physical device/PWA acceptance, independent accountable reviewers and staging/production activation remain separate gates. PR #16 stays Draft; engine stays OFF.

The dependency patch intentionally preserves upstream tabbed/blank context lines required by unified-diff syntax. `git diff --cached --check -- . ':!patches/*.patch'` passes for source/docs; an unfiltered check reports that patch-context whitespace. The patch itself was parsed/applied by pnpm, regression-tested, and verified with an offline frozen-lockfile install; no patch context was reformatted to hide the report.
