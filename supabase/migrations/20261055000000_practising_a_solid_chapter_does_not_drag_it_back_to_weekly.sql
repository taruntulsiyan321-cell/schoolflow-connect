-- PRACTISING A SOLID CHAPTER DOES NOT DRAG IT BACK TO WEEKLY.
--
-- §5.2: "Re-engaging with a chapter resets the clock — a student actively
-- working on something does not need a reminder to revise it." The clock
-- moving OUT is the whole point of that sentence.
--
-- `_apply_chapter_state` moved it IN. Every chapter a session worked in got:
--
--     next_revision_at = now() + _revision_interval_days(1)      -- always 7
--
-- whatever stage the chapter had reached. So a chapter the student had passed
-- three checks on — solid, on the 30-day cycle (§5.3) — came back to a check
-- seven days later BECAUSE they practised it. The student is punished with a
-- check for doing the one thing the feature wants: going back to good work.
-- And the reverse of the spec's sentence: they need the reminder LESS, and got
-- it 23 days sooner.
--
-- THE FIX IS ONE HOME FOR "WHEN IS THE NEXT CHECK". `_revision_next_at` takes
-- the chapter's own stage and answers with a date; the state machine asks it
-- instead of assuming stage 1. A chapter with no stage yet is stage 1, which
-- is what a first engagement means, so a new row still gets its week.
--
-- Stage 0 is the table's default for a row created by the recovery half of the
-- state machine, before any revision is scheduled. It reads as stage 1 here:
-- the alternative is `_revision_interval_days(0)`, which is NULL, and a NULL
-- interval would erase the date the engagement was supposed to set.

CREATE OR REPLACE FUNCTION public._revision_next_at(_stage integer)
RETURNS timestamptz
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
DECLARE _days int;
BEGIN
  _days := public._revision_interval_days(GREATEST(COALESCE(_stage, 1), 1));
  IF _days IS NULL OR _days <= 0 THEN
    RAISE EXCEPTION 'no revision interval for stage % — refusing to schedule on a default', _stage;
  END IF;
  RETURN now() + (_days || ' days')::interval;
END;
$function$;

COMMENT ON FUNCTION public._revision_next_at(integer) IS
  'When a chapter at this revision stage is next checked. The one home for that date (§5.3).';

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

  ------------------------------------------------------------------
  -- Chapters holding open mistakes, and the session each one needs
  ------------------------------------------------------------------
  FOR _r IN
    SELECT sm.chapter_id, count(*)::int AS open_count
      FROM public.student_mistakes sm
     WHERE sm.user_id = _ps.user_id
       AND sm.status = 'open'
       AND sm.chapter_id IS NOT NULL
       -- Matches the plan's filter: a mistake with no bank question id has no
       -- original to ladder off, and counting it here would build a session
       -- the plan then refuses.
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

    -- THE SESSION IS BUILT NOW, not when the student comes looking.
    --
    -- Wrapped because one chapter that cannot build a plan — a curriculum
    -- change, a retired question — must not lose the student their whole
    -- session finish. The state machine runs inside the finish path, and an
    -- exception here would take the XP, the streak and the attempt record
    -- with it.
    BEGIN
      _rid := public._ensure_recovery_session(
        _ps.user_id, _ps.student_id, _ps.school_id, _r.chapter_id);
      IF _rid IS NOT NULL THEN _built := _built + 1; END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'could not prepare recovery for chapter %: %', _r.chapter_id, SQLERRM;
    END;
  END LOOP;

  ------------------------------------------------------------------
  -- The revision clock: every chapter this session really worked in
  ------------------------------------------------------------------
  -- AT THE CHAPTER'S OWN STAGE. A first engagement is stage 1 and gets its
  -- week; a chapter already three passes deep keeps its 30-day cycle instead
  -- of being pulled back to seven days for having been practised.
  FOR _r IN
    SELECT ct.chapter_id, ct.attempted
      FROM public.chapter_tally ct
     WHERE ct.session_id = _session_id
       AND ct.attempted >= _engage_min
  LOOP
    INSERT INTO public.chapter_state (
      user_id, student_id, school_id, chapter_id, state, next_revision_at, revision_stage)
    VALUES (_ps.user_id, _ps.student_id, _ps.school_id, _r.chapter_id,
            'untouched', public._revision_next_at(1), 1)
    ON CONFLICT (user_id, chapter_id) DO UPDATE
      SET next_revision_at = public._revision_next_at(public.chapter_state.revision_stage),
          revision_stage   = GREATEST(public.chapter_state.revision_stage, 1),
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

-- ── THE PROOF ────────────────────────────────────────────────────────────
--
-- Behavioural, on the one thing that changed: the date a stage is given.
-- Three assertions, and the middle one is the control — without it, "stage 4
-- gives 30 days" could also be true of a function that ignored its argument
-- and always said 30.
--
--   stage 1  ->  7 days   (REVISION_INTERVALS_DAYS[1])
--   stage 4  -> 30 days   (REVISION_INTERVAL_SOLID)     <- the defect
--   stage 0  ->  7 days   (a row that has no stage yet is a first engagement)
--
-- Then the state machine itself is read, because a helper nothing calls fixes
-- nothing: its text must ask _revision_next_at and must no longer schedule
-- every chapter at the stage-1 interval.
DO $guard$
DECLARE
  _week  int := public._recovery_const('REVISION_INTERVAL_1')::int;
  _solid int := public._recovery_const('REVISION_INTERVAL_SOLID')::int;
  _d1    numeric;
  _d4    numeric;
  _d0    numeric;
  _src   text := pg_get_functiondef('public._apply_chapter_state(uuid)'::regprocedure);
BEGIN
  IF _week IS NULL OR _solid IS NULL OR _week = _solid THEN
    RAISE EXCEPTION 'the two intervals must exist and differ for this proof to mean anything (week %, solid %)', _week, _solid;
  END IF;

  _d1 := EXTRACT(EPOCH FROM (public._revision_next_at(1) - now())) / 86400;
  _d4 := EXTRACT(EPOCH FROM (public._revision_next_at(4) - now())) / 86400;
  _d0 := EXTRACT(EPOCH FROM (public._revision_next_at(0) - now())) / 86400;

  IF round(_d1) <> _week THEN
    RAISE EXCEPTION 'stage 1 should be % days, got %', _week, round(_d1);
  END IF;
  IF round(_d4) <> _solid THEN
    RAISE EXCEPTION 'a solid chapter should be % days, got % — the defect is still here', _solid, round(_d4);
  END IF;
  IF round(_d0) <> _week THEN
    RAISE EXCEPTION 'a chapter with no stage should be a first engagement (% days), got %', _week, round(_d0);
  END IF;

  IF _src NOT LIKE '%_revision_next_at(public.chapter_state.revision_stage)%' THEN
    RAISE EXCEPTION 'the state machine does not schedule at the chapter''s own stage';
  END IF;
  IF _src LIKE '%next_revision_at = now() + (_interval_1%' THEN
    RAISE EXCEPTION 'the state machine still schedules every chapter at the stage-1 interval';
  END IF;
END
$guard$;

INSERT INTO public.schema_migrations (version)
VALUES ('20261055000000_practising_a_solid_chapter_does_not_drag_it_back_to_weekly')
ON CONFLICT (version) DO NOTHING;
