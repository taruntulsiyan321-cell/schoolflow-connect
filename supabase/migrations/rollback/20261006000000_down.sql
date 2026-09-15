-- Rollback for 20261006000000_revision_stops_waiting_for_recovery.sql
--
-- Restores the 7/21/60 ladder, the two unreachable thresholds, and the two
-- behaviours the forward migration corrected (stage reset on re-engagement,
-- and 'has_mistakes' written for a chapter that was merely practised).
--
-- It does NOT delete chapter_state rows the forward migration caused to be
-- written. They are real records of real practice, and a rollback that erased
-- a student's revision schedule would lose data the forward migration only
-- ever added.

BEGIN;

UPDATE public.recovery_constants SET value = 5,  updated_at = now() WHERE key = 'RECOVERY_TRIGGER_COUNT';
UPDATE public.recovery_constants SET value = 10, updated_at = now() WHERE key = 'REVISION_ENGAGEMENT_MIN';
UPDATE public.recovery_constants SET value = 21, updated_at = now() WHERE key = 'REVISION_INTERVAL_2';
UPDATE public.recovery_constants SET value = 60, updated_at = now() WHERE key = 'REVISION_INTERVAL_3';

DELETE FROM public.recovery_constants WHERE key IN (
  'REVISION_INTERVAL_SOLID','REVISION_MISTAKE_MAX',
  'RECOVERY_DEEP_MAX_MISTAKES','RECOVERY_WIDE_MAX_MISTAKES','RECOVERY_RELEARN_ABOVE',
  'RECOVERY_DEEP_TIER0','RECOVERY_DEEP_TIER1','RECOVERY_DEEP_TIER2','RECOVERY_DEEP_TIER3',
  'RECOVERY_WIDE_TIER0','RECOVERY_WIDE_TIER1','RECOVERY_WIDE_TIER2','RECOVERY_WIDE_TIER3');

CREATE OR REPLACE FUNCTION public._revision_interval_days(_stage integer)
RETURNS integer
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $fn$
DECLARE _d int;
BEGIN
  IF _stage <= 0 THEN RETURN NULL; END IF;
  IF _stage > 3 THEN RETURN NULL; END IF;
  _d := public._recovery_const('REVISION_INTERVAL_' || _stage::text)::int;
  RETURN _d;
END;
$fn$;

CREATE OR REPLACE FUNCTION public._apply_chapter_state(_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  _ps            record;
  _trigger_count int;
  _engage_min    int;
  _interval_1    int;
  _triggered     int := 0;
  _scheduled     int := 0;
  _r             record;
BEGIN
  SELECT * INTO _ps FROM public.practice_sessions WHERE id = _session_id;
  IF _ps IS NULL THEN RETURN jsonb_build_object('error', 'no such session'); END IF;

  _trigger_count := public._recovery_const('RECOVERY_TRIGGER_COUNT')::int;
  _engage_min    := public._recovery_const('REVISION_ENGAGEMENT_MIN')::int;
  _interval_1    := public._recovery_const('REVISION_INTERVAL_1')::int;

  IF _trigger_count IS NULL OR _engage_min IS NULL OR _interval_1 IS NULL THEN
    RAISE EXCEPTION 'recovery constants missing — refusing to run the state machine on defaults';
  END IF;

  FOR _r IN
    SELECT sm.chapter_id, count(*)::int AS open_count
      FROM public.student_mistakes sm
     WHERE sm.user_id = _ps.user_id AND sm.status = 'open' AND sm.chapter_id IS NOT NULL
     GROUP BY sm.chapter_id
    HAVING count(*) >= _trigger_count
  LOOP
    INSERT INTO public.chapter_state (user_id, student_id, school_id, chapter_id, state)
    VALUES (_ps.user_id, _ps.student_id, _ps.school_id, _r.chapter_id, 'has_mistakes')
    ON CONFLICT (user_id, chapter_id) DO UPDATE
      SET state = CASE WHEN public.chapter_state.state IN ('untouched', 'has_mistakes')
                       THEN 'has_mistakes' ELSE public.chapter_state.state END,
          updated_at = now();
    _triggered := _triggered + 1;
  END LOOP;

  FOR _r IN
    SELECT ct.chapter_id, ct.attempted
      FROM public.chapter_tally ct
     WHERE ct.session_id = _session_id AND ct.attempted >= _engage_min
  LOOP
    INSERT INTO public.chapter_state (user_id, student_id, school_id, chapter_id, state, next_revision_at, revision_stage)
    VALUES (_ps.user_id, _ps.student_id, _ps.school_id, _r.chapter_id, 'has_mistakes',
            now() + (_interval_1 || ' days')::interval, 1)
    ON CONFLICT (user_id, chapter_id) DO UPDATE
      SET next_revision_at = now() + (_interval_1 || ' days')::interval,
          revision_stage   = 1,
          updated_at       = now();
    _scheduled := _scheduled + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'session_id', _session_id,
    'chapters_at_trigger', _triggered,
    'chapters_scheduled', _scheduled);
END;
$fn$;

COMMIT;
