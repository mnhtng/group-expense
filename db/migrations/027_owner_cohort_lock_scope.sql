-- SC-027. Group-owner self-service enrollment without granting cohort
-- UPDATE/INSERT, group UPDATE or global policy UPDATE to any application role.
-- Group lock and operator advisory key retain their established order.
-- The operator-only global kill switch remains intact; only the last cohort
-- revocation rule is relaxed because no admitted groups implies zero writers.
CREATE OR REPLACE FUNCTION sc025_cohort_guard() RETURNS trigger LANGUAGE plpgsql AS $sc025$
DECLARE capacity integer; admitted_count integer; rollout_enabled boolean;
BEGIN
  IF TG_OP='UPDATE' AND (NEW.group_id<>OLD.group_id OR NEW.created_at<>OLD.created_at) THEN
    RAISE EXCEPTION 'Rollout membership identity is immutable';
  END IF;
  -- Same lock order as financial writes: group, then rollout control.
  PERFORM 1 FROM groups WHERE id=NEW.group_id AND (NOT NEW.admitted OR archived_at IS NULL)
    FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Rollout requires an active group'; END IF;
  PERFORM pg_advisory_xact_lock(250025,1);
  SELECT cohort_limit,enabled INTO capacity,rollout_enabled
    FROM settlement_cycle_engine_control WHERE id=1;
  IF NOT FOUND THEN RAISE EXCEPTION 'Rollout control missing'; END IF;
  SELECT count(*) INTO admitted_count FROM settlement_cycle_engine_cohort
    WHERE admitted AND group_id<>NEW.group_id;
  IF NEW.admitted AND admitted_count>=capacity THEN
    RAISE EXCEPTION 'Rollout cohort capacity exceeded';
  END IF;
  -- Self-service may revoke the final enrolled group while global ON.
  -- No enrolled group implies no authorized financial writes.
  NEW.updated_at:=clock_timestamp();
  RETURN NEW;
END $sc025$;

-- This is the ONLY privilege needed by the special owner-enrollment role.
-- A signed server session supplies p_actor; the function independently verifies
-- live group ownership + active membership, under the existing group row lock.
-- SECURITY DEFINER is safe here only with a fixed trusted search_path and an
-- immediate PUBLIC EXECUTE revoke. Never grant EXECUTE to app runtime.
CREATE FUNCTION public.sc027_owner_cohort_change(
  p_group uuid,p_actor text,p_enabled boolean,
  p_expected_admitted boolean,p_expected_revision integer
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public
AS $sc027$
DECLARE
  v_owner text;
  v_revision integer;
  v_existing boolean;
  v_admitted boolean;
  v_opted boolean;
BEGIN
  SELECT g.owner_id INTO v_owner
  FROM public.groups g
  WHERE g.id=p_group AND g.archived_at IS NULL FOR UPDATE;
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'SC027_GROUP_NOT_FOUND' USING ERRCODE='P0002';
  END IF;
  IF v_owner<>p_actor OR NOT EXISTS(
    SELECT 1 FROM public.group_members m
    WHERE m.group_id=p_group AND m.user_id=p_actor AND m.status='active'
  ) THEN
    RAISE EXCEPTION 'SC027_NOT_OWNER' USING ERRCODE='42501';
  END IF;
  PERFORM pg_advisory_xact_lock(250025,1);
  SELECT revision INTO v_revision FROM public.settlement_cycle_engine_control
    WHERE id=1;
  IF v_revision IS NULL OR v_revision<>p_expected_revision THEN
    RAISE EXCEPTION 'SC027_CONTROL_STALE' USING ERRCODE='40001';
  END IF;
  SELECT admitted INTO v_admitted
    FROM public.settlement_cycle_engine_cohort WHERE group_id=p_group FOR UPDATE;
  v_existing:=FOUND;
  v_admitted:=COALESCE(v_admitted,false);
  IF v_admitted<>p_expected_admitted THEN
    RAISE EXCEPTION 'SC027_GROUP_STALE' USING ERRCODE='40001';
  END IF;
  IF v_admitted=p_enabled THEN
    RETURN v_admitted;
  END IF;
  IF p_enabled THEN
    SELECT requested_enabled INTO v_opted
      FROM public.group_settlement_settings WHERE group_id=p_group;
    IF COALESCE(v_opted,false) IS FALSE THEN
      RAISE EXCEPTION 'SC027_GROUP_NOT_OPTED_IN' USING ERRCODE='23514';
    END IF;
  END IF;
  IF v_existing THEN
    UPDATE public.settlement_cycle_engine_cohort
      SET admitted=p_enabled WHERE group_id=p_group;
  ELSE
    INSERT INTO public.settlement_cycle_engine_cohort(group_id,admitted)
      VALUES(p_group,p_enabled);
  END IF;
  INSERT INTO public.group_settlement_config_events
    (id,group_id,actor_id,event_type,details)
    VALUES(gen_random_uuid(),p_group,p_actor,'settings_changed',
      jsonb_build_object('subject','owner_financial_activation',
        'before',v_admitted,'after',p_enabled,'controlRevision',v_revision));
  RETURN p_enabled;
END;
$sc027$;
REVOKE ALL ON FUNCTION public.sc027_owner_cohort_change(
  uuid,text,boolean,boolean,integer) FROM PUBLIC;
