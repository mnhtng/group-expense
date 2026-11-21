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

-- Preserve the original operator rollout guard for legacy fields, but do NOT
-- let obsolete cohort limits prevent an emergency pause/unpause action.
-- The UPDATE trigger remains in force, holding the exclusive SC-025 advisory
-- lock also taken (shared) by every financial writer.
CREATE OR REPLACE FUNCTION public.sc025_control_guard() RETURNS trigger
LANGUAGE plpgsql AS $sc028_control$
DECLARE admitted_count integer;
BEGIN
  PERFORM pg_advisory_xact_lock(250025,1);
  IF NEW.id<>OLD.id THEN RAISE EXCEPTION 'Rollout identity is immutable'; END IF;
  IF NEW.enabled IS DISTINCT FROM OLD.enabled OR
     NEW.cohort_limit IS DISTINCT FROM OLD.cohort_limit THEN
    SELECT count(*) INTO admitted_count
      FROM public.settlement_cycle_engine_cohort WHERE admitted;
    IF admitted_count>NEW.cohort_limit THEN
      RAISE EXCEPTION 'Rollout limit cannot exclude admitted groups';
    END IF;
    IF NEW.enabled AND admitted_count=0 THEN
      RAISE EXCEPTION 'Cannot enable an empty rollout';
    END IF;
  END IF;
  NEW.revision:=OLD.revision+1;
  NEW.updated_at:=clock_timestamp();
  RETURN NEW;
END $sc028_control$;
