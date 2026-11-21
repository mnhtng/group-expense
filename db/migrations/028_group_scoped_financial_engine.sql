-- SC-028: self-managed financial engine per group, independent of the
-- old operator rollout cohort. Additive, default-OFF on EVERY existing group.
-- This migration NEVER enables financial writes, updates balances, or changes
-- any existing cash/noncash/snapshot/history rows.
ALTER TABLE public.group_settlement_settings
  ADD COLUMN financial_engine_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE public.group_settlement_settings
  ADD CONSTRAINT sc028_financial_engine_requires_settlement
  CHECK (NOT financial_engine_enabled OR requested_enabled);

-- The operator keeps an independent emergency stop. Unlike the legacy
-- SC-025 "enabled" rollout bit, false means healthy/unpaused.
-- The legacy control/cohort/events are retained intact for audit and safe
-- rollback to pre-SC028 code; they no longer grant financial access.
ALTER TABLE public.settlement_cycle_engine_control
  ADD COLUMN emergency_paused boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.settlement_cycle_engine_control.emergency_paused IS
  'SC-028 global emergency stop: TRUE denies all new financial writes; only operator may update.';

COMMENT ON COLUMN public.group_settlement_settings.financial_engine_enabled IS
  'SC-028 owner-controlled per-group financial write permission; requires requested_enabled and global emergency_paused=FALSE.';
