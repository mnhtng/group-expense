# Runtime attestation and alert continuation — 2026-11-09

**Local implementation and verification PASS; release NO-GO.** Code digest **`03757fecd09d8b7ba5ae50375675234738fd16eb32ee4e7e26ddc5770489c181`** identifies this candidate. Migration files 001–024 are unchanged. No provider role, credential/environment setting or deployment has been changed by this continuation at this evidence capture.

| Verification | Observed result |
|---|---|
| Node 22 unit suite | **176 PASS**, no failures/skips |
| PostgreSQL 17 integration | **12 PASS**, including real-login/current/column/future-privilege checks and actual loopback TLS delivery |
| Limited-role full application profile | Production build/TypeScript, runtime attestation **200**, HTTP, four browser profiles, eight finance audits and before/after ACL checks **PASS** |
| Ordinary owner full profile | Runtime attestation **503** as required; full HTTP, four browsers and eight finance audits **PASS** |
| Logical recovery | Existing 15 independent comparisons plus **58 full data/schema comparisons PASS** |
| Read-only monitor token | Status/runtime GET accepted; Cron/replay POST **401**; missing/wrong token **401** |
| Delivery lifecycle | OPENED once, unchanged event-ID retry after rejection/timeout, 15-minute unacknowledged escalation, manual acknowledgement and RECOVERED verified locally |
| Real email channel component | Gmail accepted one drill to the owner-supplied address; owner explicitly confirmed receipt/reading of `1ad909cd` |
| RPO/RTO policy | Owner explicitly approved **RPO ≤15m, service RTO ≤60m**; service compliance not certified |

Runtime inspection uses the application's actual `pg` pool in a read-only transaction, exposing only codes/fingerprints. Its policy now checks all 19 required guards on their correct tables, unexpected column INSERT/REFERENCES/UPDATE authority, and default grants on future objects. An independent limited LOGIN passes; an owner is rejected. The shared inventory is now a side-effect-free module; initial Next bundling of the old CLI dependency exposed a filesystem import, which was removed by this surgical split before the full successful runs.

The alert runner stores a private atomic outbox, locks overlapping processes, retries with the same event ID and keeps operator acknowledgement distinct from provider HTTP acceptance. Unknown upstream codes/free text are excluded from delivery. A real loopback HTTPS receiver with verified test CA exercised rejection/retry/timeout and recovery; the first socket attempt was sandbox-denied and was rerun with local-network permission. No external TLS or automatic hosted email success is inferred from that local test.

The Gmail drill was explicitly requested via channel/recipient selection. It was sent once through the connected Gmail tool and acknowledged by the owner in Codex. Receipt, recipient, message/thread IDs and acknowledgement are private in `rr003-artifacts/2026-11-09-runtime-alerts/` (0700 directory/0600 files). It is **not a scheduler or a deployed email backend**. See [operator/delivery runbook](RR-003-ALERT-DELIVERY.md).

Read-only Vercel metadata still shows the feature preview at older remote SHA `41bc3ae…`; its branch has no specific DB/secret env entries. Existing entries target production and preview `develop`. No secret values were decrypted or exported. [Exact isolated role + protected feature-preview package](RR-004-ISOLATED-PREVIEW-PLAN.md) and its SQL are prepared for scoped owner approval. Deployed role/HTTPS monitoring, mail-capable delivery service and persistent scheduler, positive managed finance fixtures, service RPO/RTO, physical-device and independent human release acceptance remain pending.

No GitHub Actions, push, merge, staging/production release or financial activation occurred. PR #16 stays Draft; engine hard OFF.
