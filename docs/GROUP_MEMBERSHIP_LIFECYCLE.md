# Group membership lifecycle — safe leave / removal / rejoin

**Policy:** A membership is soft-deactivated, never deleted. This retains financial
FKs, debt sources, receipts, settlement events and group membership audit events.

## States

- `active`: may see the group, be selected as a payer/expense participant,
  create expenses, pay debts, and receive settlement notifications.
- `left`: self-departed, may no longer view/manage group or be added to new
  financial items. Historical records are preserved for the active members.
- `removed`: deactivated by authorized owner/admin; financial history preserved.
- A new, unexpired invitation restores a departed membership to `active`
  with role `member`; no duplicate `group_members` record is created.
- Owner must transfer ownership to an active member before departing. The
  previous owner becomes an ordinary member; transfer is audited.

## Financial gate

Inside a PostgreSQL transaction, acquire a `groups FOR UPDATE` lock and
recalculate all ACTIVE obligations involving the member:

```
outstanding = original amount − sum(confirmed settlement allocations)
```

**Both** receivables and payables must be exactly zero (without netting), and
there must be **no pending settlement** involving the member. Rejected and
cancelled transactions do not block leaving. Pending reservations count as debt,
they never make an obligation settled. A group owner is never allowed to leave
until ownership has been transferred.

The same group-level lock is acquired before creating expenses/settlements
and accepting invites, so leave cannot race successfully with creating a
new debt that includes the departing member. Existing expense mutations and
settlement state changes use the same lock ordering.

## Authorization

- Only active memberships can access private group details or financial APIs.
- Only active members can be selected as payers/participants for new expenses.
- The owner can remove any non-owner active member; admins can remove only
  ordinary members (after financial clearance).
- No administrative force-remove that deletes obligations or bypasses debt checks.
- Historical finance/user IDs and event snapshots remain queryable by active
  authorized members.
- Rejoining a previously removed membership requires a fresh valid invitation;
  inviting an active member again is idempotent.
- No access to the former group's private data after leaving, except independent
  notifications already delivered to the user's personal inbox.

## Routes

- `GET /api/groups/:groupId/membership/leave` — preflight balances/pending.
- `POST /api/groups/:groupId/membership/leave` — transactional self-departure.
- `POST /api/groups/:groupId/membership/transfer` — owner-only; targetId.
- `DELETE /api/groups/:groupId/membership/members/:memberId` — soft removal.
- `POST /api/invites/accept` — accept valid invitation; supports reactivation.

All API routes use verified Better Auth sessions and Next.js Proxy same-origin
write validation. Group service performs final authorization in transactions.
A displayed preflight is informational; server always validates again.

## Rollout

1. Run `007_group_membership_lifecycle.sql` on disposable PostgreSQL 17.
2. CI: migration idempotency, Next.js build, active-only financial authorization,
   unresolved/pending blockers, owner transfer, rejoin, and mutation races.
3. Apply migration on Neon **development** only after CI passes.
4. Merge to `develop` and verify Vercel Preview; Production requires a
   separately approved release and migration.

Unsupported by design: leaving while financially involved but not settled;
that would require a restricted settlement-only `leaving` role and separate
access policies in a subsequent change.
