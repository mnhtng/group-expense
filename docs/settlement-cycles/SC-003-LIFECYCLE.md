# SC-003 — Metadata-only cycle lifecycle and transition engine

> State: implemented on `feat/settlement-cycles-bilateral` as a **nonfinancial**
> lifecycle. Do not deploy, merge, or run migrations on shared Neon without a
> release decision. Never confuse a reviewed cycle with money paid or reconciled.

## Scope and state machine

A cycle is an immutable identity consisting of
`(group, schedule revision, source, local [start,end), timezone, UTC [start,end))`.

Valid SC-003 transitions:

```
CREATE ---(event created)---> OPEN (version 1)
                                  |
                                  | period ended, manager or authenticated cron
                                  | event review_requested
                                  v
                            REVIEW (version 2)
```

- `OPEN` means the time window has been recorded; it does **not** imply any
  invoices were attributed. A manual or scheduled cycle can be OPEN while
  the period is current, and a delayed cron may create a past OPEN period.
- `REVIEW` means the period boundary has passed and a manager may **later**
  perform eligibility review under SC-004. It is **not** financially locked.
- **No `locked`, `settling`, `financially_settled`, `completed` transitions**
  are permitted until later, separately tested tickets add financial guards.
- State cannot go backwards, cannot be deleted/rewritten and cannot skip.
  PostgreSQL trigger enforces only OPEN -> REVIEW (version 1 -> 2 after end).
- Both create and review write separate append-only audit events with
  `initiator=member` or `initiator=cron`. A Cron event has no actor ID
  and cannot impersonate a group member.
- `SETTLEMENT_CYCLE_ENGINE_READY=false` remains unchanged.
  SC-003 can persist **metadata-only** cycles for groups that explicitly set
  `requested_enabled=true`. This never activates the FINANCIAL engine.

## Activation and access

- No settings row, `requested_enabled=false`, archived group or non-member:
  **cannot create or transition any cycle**. Existing cycle history is not
  destroyed by disabling the group.
- The active owner or a currently delegated, active member may create manual
  cycles, request review and manually trigger metadata refresh. Ordinary
  `admin` is not enough. Revocation and ownership transfer take effect
  within the same group-row lock as lifecycle changes.
- The most recent audited `OFF -> ON` event defines the **activation instant**.
  Never generate a new automatic OR manual cycle with its local start UTC
  instant earlier than activation. On disable/re-enable, skipped old periods
  are not silently backfilled.
- A retry for an existing manual request key may return its original ID if
  `actor`, dates and group match; a reused key with different content is HTTP
  409. Reading historical cycles is still available to active members while
  the feature is disabled.

## Time and schedule cutovers

- Local periods are half-open `[startDate,endDate)`. Their timestamps use
  SC-002 `localMidnightInstant` and IANA timezone, NOT fixed 24-hour offsets.
- `EXCLUDE USING gist(group_id WITH =, tstzrange(start_at,end_at,'[)') WITH &&)`
  protects against *all* overlap across schedule revisions and different
  timezones, including simultaneous requests and SQL bypasses.
- Start/end instants are immutable after creation; adjacent intervals whose
  boundaries touch are allowed. No cycle may straddle a subsequent active
  schedule revision's `effective_at`.
- Manual creation is only available under an **already active manual
  schedule**; start cannot be in the future or before that schedule / the
  latest opt-in. End must be after start, at most 370 local days later, and
  not cross the next schedule cutover.
- SC-002 schedule edits now check existing cycles under group lock, refusing
  any effective instant strictly inside a persisted cycle.
- Weekly/biweekly/monthly scheduled periods derive exclusively from
  SC-002 pure calendar functions; manual schedules are NEVER auto-generated.
- DST ambiguous/missing midnight fails closed; no guessed financial periods.
- If the cron is delayed, only full periods starting during the current
  opt-in window are considered. It may create an already-finished cycle
  OPEN and immediately move it to REVIEW atomically. Missing periods remain
  eligible in the next bounded run.

## APIs and cron

- `GET /api/groups/:groupId/settlement-cycle/cycles`: reads up to 50 newest
  metadata records; includes `canManage` and always
  `effectiveEnabled:false`. Requires active group membership.
- `POST /api/groups/:groupId/settlement-cycle/cycles`:
  exactly `{expectedScheduleVersion,requestKey,startDate,endDate}`.
  Session-derived actor and group-row lock, manual schedule only,
  idempotent by `UNIQUE(group_id,request_key)`.
- `POST /api/groups/:groupId/settlement-cycle/cycles/:cycleId/review`:
  exactly `{expectedVersion}`. Rejects early review and stale/duplicate
  updates; no option to lock or approve finances.
- `POST /api/groups/:groupId/settlement-cycle/cycles/refresh`:
  body `{}`; authenticated authorized manager can re-check current group's
  scheduled metadata; never runs a transfer or set-off.
- The **existing** authenticated daily `/api/internal/push-drain` Cron
  uses `processCycleMetadataCron(30,24)` as another independent
  `Promise.allSettled` task. Same `CRON_SECRET` Bearer verification as
  existing notification/recurring processing. No extra cron schedule.
- Group processing capped to 24 create/review operations per run and max
  30 groups per invocation. `group_settlement_cycle_cron_checkpoints`
  rotates unprocessed groups first so no group is permanently starved.
- Cron is retry-safe using group row locks, immutable revision identity,
  `UNIQUE` constraints and GiST exclusion. Errors surface in a structured
  `cycles.errors` result and cause HTTP 500 for monitoring, not silent
  success. Failures for one group do not discard successful groups.
- Must not use UI list pagination to calculate future financial totals.

## Database invariants

Migration: `013_settlement_cycle_lifecycle.sql`.
Tables: `group_settlement_cycles`, `group_settlement_cycle_events`,
`group_settlement_cycle_cron_checkpoints`; plus composite
`(schedule_revision_id,group_id)` FK target unique index.

- No new invoices, obligations, settlement allocations, snapshots or set-offs.
- `period_start<period_end`, `start_at<end_at`, valid state and review
  timestamp pairing, source/actor/request-key pairing and unique cycle
  identity. PostgreSQL exclusion prevents any overlapped UTC ranges.
- Audit events are append-only and unique per cycle version.
- SQL assertions prove no writes to financial tables.
- DB migration is append-only; no destructive table/data operations.

## Release and next ticket

SC-003 is a feature-branch-only metadata implementation, not a claim that
real user money is safe to settle by period. No shared Neon migration, no
staging/production deployment, and PR #16 remains Draft.

SC-004 alone will add *eligible obligation snapshot semantics*, including
pending/confirmed cash, late invoices, review and financial locking with
explicit guards. Do **NOT** unlock financial transitions or modify ledgers
in SC-003.
