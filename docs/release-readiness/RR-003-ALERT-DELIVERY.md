# RR-003 alert delivery and operator acknowledgement

**Implemented and locally verified; hosted automatic email monitoring remains pending.** The owner chose email and explicitly confirmed receipt/reading of drill `1ad909cd-a633-4835-9e5d-af650dd822bb`. The recipient and Gmail receipt are retained privately, not in source. That was a single agent-invoked Gmail component test; it does not certify a scheduled monitor.

## Probe and delivery authority

The application's GET-only `/api/internal/settlement-ops/status` and `/runtime` endpoints accept a distinct `OPS_READ_SECRET`. This token cannot authorize Cron or replay POSTs; existing `CRON_SECRET` access remains compatible. A hosted monitor should receive only `OPS_READ_SECRET`, plus its separately provisioned delivery credential. All endpoints return private/no-store responses. Runtime attestation reports codes and SHA-256 fingerprints rather than credentials, role names or connection URLs.

`rr003-ops-monitor.mjs` performs one bounded authenticated HTTPS GET. `rr003-alert-runner.mjs` adds a persistent local outbox and manual operator acknowledgement. It uses a private state file plus exclusive lock, atomic replacement and fixed-shape redacted events. It has no application database credentials and cannot replay jobs or change financial state.

## Incident behaviour

- First unhealthy probe queues OPENED with unique incident/event IDs. Repeated failures retain the same incident.
- After 15 minutes without acknowledgement, it queues one ESCALATED event. This escalation interval is an operational rule, separate from the approved RPO target.
- An operator acknowledges the current incident explicitly; HTTP acceptance by the delivery provider never counts as a human acknowledgement. Acknowledgement suppresses later escalation but does not close an unhealthy incident.
- A later healthy probe queues RECOVERED once. A new failure after recovery opens a new incident.
- Delivery is FIFO with at-least-once retries using the same `Idempotency-Key`. The recipient must deduplicate by event ID. If the process fails after provider acceptance but before local persistence, duplicate receipt is possible.
- Non-2xx, transport failure and timeout retain the unsent event. No redirect is followed. The outbox is bounded at 100 events; a full/corrupt state fails closed instead of silently dropping events.

The current delivery transport is the reviewed HTTPS webhook contract. A persistent email service/adapter and scheduler have not been provisioned; the Gmail component test must not be presented as that backend. The existing Vercel project metadata has no email integration. The owner subsequently approved a standalone Resend Free installation with no project connection/env pull; the provider currently requires browser terms acceptance before provisioning. [Exact pending action](RR-003-MAIL-PROVISIONING-PLAN.md). Before enabling scheduling, provision an approved mail-capable receiver/provider and prove actual probe → queued event → email → human acknowledgement → recovered email on the deployed candidate.

## Operator commands (prepared; no external schedule enabled)

On the approved monitor host, provision the status URL/hostname, dedicated read token, approved delivery URL/hostname and delivery secret through its secret manager. Use an absolute `RR003_ALERT_STATE_FILE` on persistent private storage. The CLI requires `RR003_ALERT_RUN=approved-delivery` before sending anything:

```sh
node scripts/rr003-alert-runner.mjs poll
```

A named operator with access to the monitor host acknowledges an incident using its exact UUID and a non-sensitive alias in `RR003_OPERATOR_ID`:

```sh
node scripts/rr003-alert-runner.mjs ack <incident-uuid>
```

The alias is hashed in state. This records an operator CLI action; independent authentication/access records come from the monitor host. Protect its filesystem and operator access. Run one poll per minute after explicit activation. Exit 0 means healthy and no pending delivery; 1 means unhealthy or pending delivery; 2 means invalid configuration/state, conflicting lock or operational failure. The supervisor must surface runner failures too. A stale lock after a crash requires verifying that the former process is dead before removing that lock; never auto-delete a live lock. Filesystem atomic replacement protects process restarts, not storage loss; retain/monitor the persistent state volume separately.

## Actual evidence and remaining scope

Local unit tests cover state transitions, acknowledgement, queue retries, token/code redaction, invalid destinations, timeouts, corrupt state and overlapping runs. A real loopback HTTPS recipient verifies TLS with a test CA, rejects/retries deliveries, times out, accepts recovery and observes escalation. No TLS verification bypass is used. The real Next HTTP profile proves the read token can inspect status/runtime but cannot POST Cron; the non-owner profile passes attestation while the owner profile is denied.

The owner approved **RPO ≤15 minutes and service RTO ≤60 minutes** on 2026-11-09. These are accepted targets, not proof of compliance. The earlier historical recovery measured database-only intervals against a quiescent sparse source; a full-service recovery/cutover and continuing-write RPO drill remain pending. Six-hour Neon history is a retention window, not an approved substitute for incident detection/backup policy.

The separately approved protected feature preview now returns runtime attestation 200 with the correct limited role and authenticated status 503 / NO_COMPLETED_CRON_RUN. OIDC machine access was exercised without a project-wide bypass; [managed proof](RR-004-MANAGED-RUNTIME-EVIDENCE.md). No Cron recovery action was included.

Outstanding: mail service/receiver, persistent scheduler, external fault/recovery drill and service RPO/RTO acceptance. No staging/production deployment or engine activation is performed by this runbook.
