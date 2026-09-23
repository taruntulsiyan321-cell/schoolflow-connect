-- ROLLBACK 20261055000000 — schedules every engaged chapter at the stage-1
-- interval again, whatever stage it had reached.
--
-- THIS RESTORES THE DEFECT: a chapter the student has passed three checks on
-- is pulled from its 30-day cycle back to a check in seven days BECAUSE they
-- practised it — the opposite of §5.2's "a student actively working on
-- something does not need a reminder to revise it".
--
-- The body below is the one that stood before 20261055000000, restored
-- verbatim. `_revision_next_at` is dropped with it: nothing else calls it.

CREATE OR REPLACE FUNCTION public._apply_chapter_state(_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _ps            record;
  _trigger_count int;
  _engage_min    int;
  _interval_1    int;
  _triggered     int := 0;
  _scheduled     int := 0;
  _built         int := 0;
  _r             record;
  _rid           uuid;
BEGIN
  SELECT * INTO _ps FROM public.practice_sessions WHERE id = _session_id;
  IF _ps IS NULL THEN RETURN jsonb_build_object('error', 'no such session'); END IF;

  _trigger_count := public._recovery_const('RECOVERY_TRIGGER_COUNT')::int;
  _engage_min    := public._recovery_const('REVISION_ENGAGEMENT_MIN')::int;
  _interval_1    := public._revision_interval_days(1);

  IF _trigger_count IS NULL OR _engage_min IS NULL OR _interval_1 IS NULL THEN
    RAISE EXCEPTION 'recovery constants missing — refusing to run the state machine on defaults';
  END IF;

  FOR _r IN
    SELECT sm.chapter_id, count(*)::int AS open_count
      FROM public.student_mistakes sm
     WHERE sm.user_id = _ps.user_id
       AND sm.status = 'open'
       AND sm.chapter_id IS NOT NULL
       AND sm.question_id IS NOT NULL
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

    BEGIN
      _rid := public._ensure_recovery_session(
        _ps.user_id, _ps.student_id, _ps.school_id, _r.chapter_id);
      IF _rid IS NOT NULL THEN _built := _built + 1; END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'could not prepare recovery for chapter %: %', _r.chapter_id, SQLERRM;
    END;
  END LOOP;

  FOR _r IN
    SELECT ct.chapter_id, ct.attempted
      FROM public.chapter_tally ct
     WHERE ct.session_id = _session_id
       AND ct.attempted >= _engage_min
  LOOP
    INSERT INTO public.chapter_state (
      user_id, student_id, school_id, chapter_id, state, next_revision_at, revision_stage)
    VALUES (_ps.user_id, _ps.student_id, _ps.school_id, _r.chapter_id,
            'untouched', now() + (_interval_1 || ' days')::interval, 1)
    ON CONFLICT (user_id, chapter_id) DO UPDATE
      SET next_revision_at = now() + (_interval_1 || ' days')::interval,
          updated_at       = now();
    _scheduled := _scheduled + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'session_id', _session_id,
    'chapters_at_trigger', _triggered,
    'chapters_scheduled', _scheduled,
    'recovery_sessions_prepared', _built);
END;
$function$;

DROP FUNCTION IF EXISTS public._revision_next_at(integer);

-- Fail closed: the stage-1 schedule must be back, and the helper gone.
DO $check$
DECLARE _src text := pg_get_functiondef('public._apply_chapter_state(uuid)'::regprocedure);
BEGIN
  IF _src NOT LIKE '%next_revision_at = now() + (_interval_1%' THEN
    RAISE EXCEPTION 'the stage-1 schedule was not restored';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = '_revision_next_at'
  ) THEN
    RAISE EXCEPTION '_revision_next_at still exists';
  END IF;
END
$check$;

DELETE FROM public.schema_migrations
 WHERE version = '20261055000000_practising_a_solid_chapter_does_not_drag_it_back_to_weekly';
