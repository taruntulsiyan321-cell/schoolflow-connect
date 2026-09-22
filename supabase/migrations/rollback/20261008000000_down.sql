-- Rollback for 20261008000000_a_revision_check_is_the_misses_and_the_unseen.sql
--
-- Drops rpc_revision_session_plan and restores the two functions the forward
-- migration rewrote.
--
-- What this re-introduces, stated plainly because it is not a neutral undo:
--   * Nothing anywhere enforces §5.4. A revision check can again contain
--     questions the student answered last week.
--   * The check contains none of the student's own mistakes, so a chapter can
--     pass three checks with every mistake in it still open.
--   * The REVISION_COUNT floor moves back to the total, so a sitting made
--     entirely of the student's mistake book satisfies it.
--   * Passing the third check sets next_revision_at to NULL again, dropping
--     the chapter out of the schedule permanently.
--
-- revision_sessions rows written while the forward migration was in force are
-- left alone; their correct/total columns mean the same thing either way.

BEGIN;

DROP FUNCTION IF EXISTS public.rpc_revision_session_plan(uuid);

CREATE OR REPLACE FUNCTION public.rpc_submit_revision_session(_chapter_id uuid, _practice_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  _uid uuid := auth.uid();
  _sid uuid; _school uuid; _cs public.chapter_state%ROWTYPE;
  _correct int; _total int; _stage int; _pass_thr numeric; _rate numeric;
  _passed boolean; _stages int; _next int; _trigger text; _solid boolean := false;
  _next_at timestamptz; _state text; _sat_at timestamptz; _since timestamptz;
  _want int; _available int;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;

  SELECT * INTO _cs FROM public.chapter_state WHERE user_id = _uid AND chapter_id = _chapter_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'this chapter has no revision scheduled'; END IF;

  SELECT ps.created_at INTO _sat_at FROM public.practice_sessions ps
   WHERE ps.id = _practice_session_id AND ps.user_id = _uid;
  IF _sat_at IS NULL THEN RAISE EXCEPTION 'practice session not found'; END IF;

  SELECT GREATEST(
           COALESCE(_cs.recovered_at, _cs.created_at),
           COALESCE((SELECT max(vs.completed_at) FROM public.revision_sessions vs
                      WHERE vs.user_id = _uid AND vs.chapter_id = _chapter_id), _cs.created_at),
           _cs.created_at) INTO _since;
  IF _sat_at < _since THEN
    RAISE EXCEPTION 'that sitting is older than this chapter''s last assessment — sit the check now';
  END IF;

  IF EXISTS (SELECT 1 FROM public.revision_sessions vs
              WHERE vs.practice_session_id = _practice_session_id) THEN
    RAISE EXCEPTION 'that practice session has already been recorded as a revision check';
  END IF;

  SELECT count(*)::int,
         count(*) FILTER (WHERE qa.is_correct AND NOT COALESCE(qa.skipped, false))::int
    INTO _total, _correct
    FROM public.question_attempts qa
    JOIN public.question_bank qb ON qb.id = qa.bank_question_id
   WHERE qa.session_id = _practice_session_id AND qa.user_id = _uid
     AND qb.chapter_id = _chapter_id;

  IF _total IS NULL OR _total = 0 THEN
    RAISE EXCEPTION 'that session answered no question in this chapter — a check with no questions is not a result';
  END IF;

  _want := public._recovery_const('REVISION_COUNT')::int;
  SELECT count(*)::int INTO _available FROM public.question_bank qb
   WHERE qb.chapter_id = _chapter_id AND qb.is_active AND qb.is_approved;
  _want := LEAST(_want, GREATEST(_available, 1));

  IF _total < _want THEN
    RAISE EXCEPTION 'a revision check needs % questions from this chapter; that sitting answered %', _want, _total;
  END IF;

  SELECT s.id, s.school_id INTO _sid, _school FROM public.students s WHERE s.user_id = _uid LIMIT 1;

  _stage    := GREATEST(_cs.revision_stage, 1);
  _pass_thr := public._recovery_const('REVISION_PASS_THRESHOLD')::numeric;
  _stages   := public._recovery_const('REVISION_STAGES_TO_SOLID')::int;
  _rate     := round(_correct::numeric / _total, 4);
  _passed   := _rate >= _pass_thr;
  _trigger  := CASE WHEN _cs.recovered_at IS NOT NULL THEN 'recovery' ELSE 'engagement' END;

  INSERT INTO public.revision_sessions (
    user_id, student_id, school_id, chapter_id, stage,
    correct, total, passed, completed_at, triggered_by, practice_session_id)
  VALUES (_uid, COALESCE(_sid, _cs.student_id), COALESCE(_school, _cs.school_id),
          _chapter_id, _stage, _correct, _total, _passed, now(), _trigger, _practice_session_id);

  IF _passed THEN
    IF (_cs.consecutive_revision_passes + 1) >= _stages THEN
      _solid := true;
      UPDATE public.chapter_state SET
        consecutive_revision_passes = _cs.consecutive_revision_passes + 1,
        revision_stage = _stage, next_revision_at = NULL,
        state = 'recovered', updated_at = now()
      WHERE user_id = _uid AND chapter_id = _chapter_id;
    ELSE
      _next := public._revision_interval_days(_stage + 1);
      UPDATE public.chapter_state SET
        consecutive_revision_passes = _cs.consecutive_revision_passes + 1,
        revision_stage = _stage + 1,
        next_revision_at = now() + (_next || ' days')::interval,
        state = 'recovered', updated_at = now()
      WHERE user_id = _uid AND chapter_id = _chapter_id;
    END IF;
  ELSE
    _next := public._revision_interval_days(1);
    UPDATE public.chapter_state SET
      state = 'revision_failed', consecutive_revision_passes = 0, revision_stage = 1,
      next_revision_at = now() + (_next || ' days')::interval, updated_at = now()
    WHERE user_id = _uid AND chapter_id = _chapter_id;
  END IF;

  SELECT cs.next_revision_at, cs.state INTO _next_at, _state
    FROM public.chapter_state cs WHERE cs.user_id = _uid AND cs.chapter_id = _chapter_id;

  RETURN jsonb_build_object(
    'passed', _passed, 'rate', _rate, 'correct', _correct, 'total', _total,
    'stage', _stage, 'solid', _solid,
    'consecutive_passes', CASE WHEN _passed THEN _cs.consecutive_revision_passes + 1 ELSE 0 END,
    'stages_to_solid', _stages, 'next_revision_at', _next_at, 'state', _state);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.rpc_student_chapter_states()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE _uid uuid := auth.uid(); _out jsonb;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;

  SELECT COALESCE(jsonb_agg(row ORDER BY row->>'next_revision_at' NULLS LAST), '[]'::jsonb)
    INTO _out
    FROM (
      SELECT jsonb_build_object(
               'chapter_id', cs.chapter_id, 'chapter', c.name, 'subject', sub.name,
               'state', cs.state, 'revision_stage', cs.revision_stage,
               'consecutive_passes', cs.consecutive_revision_passes,
               'next_revision_at', cs.next_revision_at,
               'revision_due', (cs.next_revision_at IS NOT NULL AND cs.next_revision_at <= now()),
               'recovered_at', cs.recovered_at,
               'last_recovery_readiness', cs.last_recovery_readiness,
               'open_mistakes', (SELECT count(*) FROM public.student_mistakes sm
                                  WHERE sm.user_id = _uid AND sm.chapter_id = cs.chapter_id
                                    AND sm.status = 'open')) AS row
        FROM public.chapter_state cs
        LEFT JOIN public.chapters c ON c.id = cs.chapter_id
        LEFT JOIN public.curriculum_subjects sub ON sub.id = c.curriculum_subject_id
       WHERE cs.user_id = _uid
    ) t;
  RETURN _out;
END;
$fn$;

COMMIT;
