# Sprint 4 — Two-party partial repayment and settlement confirmation

## Rules
- Both debtor and creditor may report money as sent/received. The other party alone can confirm or reject.
- Initiator alone can cancel a pending request. Confirm/reject/cancel is terminal.
- Pending reserves amounts but **does not reduce outstanding**. Confirmed reduces outstanding.
- Rejected/cancelled release reservation, with immutable settlement events.
- Multiple obligations in the same group/directional pair can be paid by a single settlement.
- Exactly one `requestKey` per user submission supports idempotent retries; repeated key with changed content returns 409.
- Group-level PostgreSQL `FOR UPDATE` lock serializes expense mutation with new settlements; terminal transitions lock settlement rows.
- Versioned source expenses are not editable/deletable if they have pending or confirmed settlement allocations.
- Amounts are exact VND decimal strings / PostgreSQL `bigint`, no float math or ORM.
- Strict SQL composite FKs prevent cross-group / cross-pair allocation.

## Acceptance
- PostgreSQL migration 005 succeeds on disposable Postgres 17, rerun verifies checksum.
- Next.js HTTP smoke covers idempotency, partial, pending reservation, cross-user/role access, reject/cancel, confirmation, no double resolution, multi-obligation allocation, stale outstanding, invalid amount and concurrent overbooking.
- UI provides repayment reports, counterparty confirmation and event timeline.
- No payout/transfer occurs via the app: the two users attest an external payment.
- No unilateral settlement; no automatic bidirectional netting.

## Deployment
Apply 005 only to Neon `development` after CI success, then merge to `develop`.
`main` and Neon production remain untouched.
Potential future additions: notifications, more sophisticated receipt correction after confirmed settlement, settlement expiration, reconciliation/reporting and pagination.
