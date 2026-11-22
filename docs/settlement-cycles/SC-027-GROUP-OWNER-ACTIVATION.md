# SC-027 — Group-owner activation in Cài đặt quyết toán

Status: **feature implementation; staging/production rollout not authorized by this document**.

## User-facing behavior

- Location: **Nhóm → Quản lý nhóm → Cài đặt quyết toán → Thanh toán theo kỳ**.
- Only the **active group owner** sees the enrollment panel. A delegated settlement manager, group admin or normal member cannot access its GET/PATCH endpoint, even by calling it directly.
- Owner first saves **Bật quyết toán**. Then **Đăng ký/Mở thanh toán cho nhóm** enrolls only this group. An additional confirmation is required. **Thu hồi quyền thanh toán** removes admission, even for the last group.
- The operator-level **global pause remains independently authoritative**. When global is OFF, the owner can pre-enroll or revoke, but the app clearly says financial writes remain disabled. No owner action can modify the global control.
- When globally ON, engine access additionally requires group admission and existing opt-in. Bilateral also requires the existing group bilateral opt-in.
- The SC-025 cohort capacity **1/5/25** still applies. When capacity is reached, owner sees an explicit message rather than bypassing the cap.
- Group owner action does not confirm bilateral proposals, create CASH, NONCASH, change snapshots, rewrite obligations, or skip two-party consent.
- The app can continue to create/lock periods while the global financial engine is paused; this is intentional.

## Security and implementation

- **No administrator dashboard.** A group-owned panel appears in the existing settlement settings.
- A signed Better Auth session is required. The mutation independently locks the group, checks that `groups.owner_id` matches the authenticated actor and the active group membership, then checks cohort state and the operator policy revision.
- App runtime `DATABASE_URL` retains **SELECT only** on `settlement_cycle_engine_control`, `settlement_cycle_engine_cohort` and its immutable event history. Do not grant it cohort mutations.
- The separate secret `SETTLEMENT_OWNER_ACTIVATION_DATABASE_URL` must point to a non-admin LOGIN with **only EXECUTE on one approved function**, not to the regular app runtime or the Neon database owner. The API checks its role profile and fails closed without that credential.
- Scoped role must not receive DML on **any table**. It gets CONNECT, schema USAGE and EXECUTE on `public.sc027_owner_cohort_change(uuid,text,boolean,boolean,integer)`. The function has a fixed search path and PUBLIC EXECUTE revoked in the same migration.
- The function atomically locks the group, verifies authenticated owner + membership, checks stale versions, enforces the cohort cap via existing trigger, and appends `group_settlement_config_events` with actor ID. The existing `settlement_cycle_engine_events` records the function-owner database role and before/after values; the separate group audit preserves the authenticated human actor.
- Request body allows only `enabled`, `expectedAdmitted`, `expectedControlRevision`. Server uses parameterized SQL, group locks and SQL capacity guards.
- Migration `027_owner_cohort_lock_scope.sql` preserves the original `FOR UPDATE` row lock inside the SC-025 trigger, but executes this through a tightly scoped SECURITY DEFINER function under a privileged DB-owned function. It allows revoking the final group without changing the operator global switch; zero admitted groups means zero authorized financial writes.

## One-time staging operator configuration (requires separate approval)

1. Rehearse migration 027 on a **disposable Neon branch** made from staging. Verify all 001–027 migration hashes; SC-025 and SC-026 must remain unchanged. Preserve original financial row hashes.
2. Provision a dedicated **scoped LOGIN** role on Neon staging with a generated password kept outside Git; **never use the Neon owner/admin credentials in the app**. Example SQL for the approved database administrator (review before execution; placeholder is NOT a password):

```sql
CREATE ROLE group_expense_owner_activation LOGIN
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION
  PASSWORD '<GENERATE-UNIQUE-SECRET>';
GRANT CONNECT ON DATABASE group_expense TO group_expense_owner_activation;
GRANT USAGE ON SCHEMA public TO group_expense_owner_activation;
GRANT EXECUTE ON FUNCTION
  public.sc027_owner_cohort_change(uuid,text,boolean,boolean,integer)
  TO group_expense_owner_activation;
GRANT INSERT, UPDATE ON settlement_cycle_engine_cohort
  TO group_expense_owner_activation;
GRANT INSERT ON settlement_cycle_engine_events,
  group_settlement_config_events TO group_expense_owner_activation;
```

   Restrict ownership, memberships, schema CREATE/TEMP, inherited privileges and future grants. Verify no DML to cohort, global control, groups, users or financial tables and no other executable SECURITY DEFINER functions. Never grant this function to regular runtime.

3. Configure **only Vercel Preview staging** environment variable `SETTLEMENT_OWNER_ACTIVATION_DATABASE_URL` with that role's SSL-protected PostgreSQL URL; do not change `DATABASE_URL`. Never log or commit it.
4. Merge/deploy source only after schema, role, build and signed HTTP/authorization integration tests pass. Keep global control OFF during initial deployment.
5. Using synthetic groups and accounts, prove: owner-only GET/PATCH; admin/delegate/member denial; global OFF pre-enrollment with zero finance writes; global ON activation in isolated rehearsal only; true two-party approvals, CASH/NONCASH conservation; capacity one; other group blocked; owner revokes last enrollment while global ON; re-enroll; operator pauses globally with all new financial writes denied; rollback/history integrity.
6. Operator separately decides whether to turn **global ON** in staging. This is a **one-time emergency-control state**, not a setting any group owner may alter. Until then the owner can enroll, but real group settlement payments remain blocked. **Do not enable it on production without an explicit release decision.**

## Release acceptance

- [ ] Migration 027 on disposable PostgreSQL 17 passes and preserves existing data.
- [ ] Dedicated role is proved non-admin and least-privilege, including trigger path.
- [ ] Owner/nonowner concurrent signed HTTP positive/negative E2E completed.
- [ ] Financial write/pause/revoke/retry/idempotency and immutable audit scenarios PASS.
- [ ] Build, typecheck, full CI and migrations are green.
- [ ] Staging deployment and actual role configuration verified.
- [ ] No production financial engine activation or data change performed without separate approval.
