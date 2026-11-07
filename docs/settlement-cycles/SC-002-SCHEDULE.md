# SC-002 — Settlement cycle calendar configuration

> Completed in SC-002 only. **Configuration metadata, no active cycle engine.**
> Source of truth: `lib/settlement-cycles/calendar.ts`,
> `lib/settlement-cycles/schedule.ts`,
> `db/migrations/012_settlement_cycle_schedule.sql`.

## Public configuration

- `frequency`: `weekly` (7 calendar days), `biweekly` (14 calendar days),
  `monthly` (calendar month anchored to day 1–31), `manual` (no generated periods).
- `timeZone`: validated IANA zone (`Asia/Ho_Chi_Minh` default). Distinct from
  the server/container timezone. No custom UTC offset strings.
- `anchorDate`: **local** date `YYYY-MM-DD` representing first instant of the
  schedule's first period. UI renders `d/m/yyyy`.
- `expectedVersion`: compare-and-swap schedule version; absent schedule is version 0.
- `effectiveAt`: precisely `00:00:00` local time on `anchorDate`, converted
  to UTC and stored `timestamptz`. It is **not** a payment due date or a bill.
- First schedule must begin **after the current local date**, not today or earlier.
- An editor can change a plan that is still pending; the previous revision
  remains in the database marked superseded, with a new append-only audit entry.
- Once a plan is in force it can **never** be edited or deleted. Changes produce
  a new revision at the start of a FUTURE period of that original plan.
- A timezone switch is allowed only if old and new IANA timezones agree on the
  **exact UTC instant** of local midnight at the chosen cutover. Otherwise
  reject instead of manufacturing a period gap or overlap.
- A local date with a missing/repeated midnight due to timezone/DST rules
  is rejected. There is no implicit shift to 01:00 or an earlier date.

## Calendar examples

| Frequency | Anchor | Period A | Period B |
|---|---|---|---|
| Weekly | 2/11/2026 | [2/11,9/11) | [9/11,16/11) |
| Biweekly | 9/11/2026 | [9/11,23/11) | [23/11,7/12) |
| Monthly (day 31) | 31/1/2026 | [31/1,28/2) | [28/2,31/3) |
| Manual | any future local day | no auto-calculated period | by explicit operation in later ticket |

All intervals are local **half-open** ranges `[start,end)`.
The end of the prior period is the start of the next period, so a local
date is never attributed to two adjacent calendar periods.

A monthly anchor always retains its original **day of month** across short
months (e.g. 31 January -> 28 February -> 31 March), not drifting to the 28th
permanently. **Changing the schedule resets the new anchor day**; choosing 28
February for a NEW monthly schedule will create future 28th-day periods.
To continue a day-31 schedule after a change, choose an appropriate
future start date ending on the 31st and aligned with the old schedule.

Changing frequency is allowed only at a boundary of the old schedule.
For example, if an existing biweekly schedule starts 9 November, the
next applicable dates include 23 November, 7 December and so on, not
16 November. The new frequency then starts a complete period at its
new anchor date.

## Data integrity

- `group_settlement_schedule_heads`: authoritative group-local CAS version.
- `group_settlement_schedule_revisions`: complete immutable effective history,
  except `superseded_at` may be set once **while still future**.
- `group_settlement_schedule_events`: append-only actor/previous/new
  provenance. PostgreSQL triggers prevent UPDATE/DELETE.
- A unique schedule revision version per group, and a unique unsuperseded
  cutover instant per group; all writes are serialized by the group's row
  lock, which is also used for owner/delegate revocation.
- There may be historical active revisions and **at most one pending**
  unsuperseded future revision. Replacing a pending revision does not alter
  active history.
- Retry with unchanged pending contents is a no-op and does not create
  another audit event. A stale `expectedVersion` returns HTTP 409.
- SC-001 `SETTLEMENT_CYCLE_ENGINE_READY=false` remains unchanged; neither
  `requestedEnabled` nor a valid schedule enables financial behavior.

## HTTP surface

`GET /api/groups/:groupId/settlement-cycle/schedule` returns
`{version,current,pending,canManage,effectiveEnabled:false}`.
Only active group members can read. Archived groups and outsiders fail closed.

`PATCH /api/groups/:groupId/settlement-cycle/schedule` requires exactly:
```json
{
  "expectedVersion": 0,
  "frequency": "weekly",
  "timeZone": "Asia/Ho_Chi_Minh",
  "anchorDate": "2026-11-09"
}
```

The server derives the actor from the authenticated session and validates
the manager permission INSIDE the row-locked transaction. A group admin
without a grant has no special access. Extra keys, malformed JSON, invalid
IANA zones/dates, unaligned cutovers and stale updates fail with 400/409,
with 403 for unauthorized members and 404 for archived/other groups.

## Release and next-ticket gates

- SC-002 does **not** create schedule cycles or obligations. `SC-003`
  will use these persisted revisions as its input to the cycle state machine.
- Deploy only after an isolated database migration test and explicit release
  authorization. No schema 012 on shared Neon development or production.
- Test cases: leap-year/Feb 28/29, month 31, weekly vs biweekly boundary,
  invalid midnight, timezone offset mismatch, simultaneous version writes,
  owner/delegate/revoked admin, rejected stale values and audit immutability.
- Schema 012 contains no modifications to money/ledger/history tables.
