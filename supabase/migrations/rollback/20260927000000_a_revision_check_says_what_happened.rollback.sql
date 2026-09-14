-- Rollback for 20260927000000.
--
-- Puts rpc_submit_revision_session back to returning six keys instead of
-- eight: no next_revision_at and no state.
--
-- READ THIS FIRST: the client reads both. src/lib/revisionVerdict.ts and the
-- revision card in PracticeSessionResult.tsx were added in the same commit,
-- and the card renders "Next check on <date>" from next_revision_at. After
-- this rollback that date is undefined, so the card falls to its other branch
-- and tells every student "No next check scheduled — this chapter is off the
-- list", which is true only for a chapter that has gone solid. Roll the client
-- back with it, or do not roll this back.
--
-- The body below is 20260922000000's, unchanged except that it is reproduced
-- here rather than referenced: migration file text is not a reliable picture
-- of what is live in this database (20260828200000 rewrote ten bodies in
-- place), so a rollback that said "re-apply 20260922000000" would be guessing.

BEGIN;

CREATE OR REPLACE FUNCTION public.rpc_submit_revision_session(_chapter_id uuid, _correct integer, _total integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
DECLARE
  _uid      uuid := auth.uid();
  _sid      uuid;
  _school   uuid;
  _cs       public.chapter_state%ROWTYPE;
  _stage    int;
  _pass_thr numeric;
  _rate     numeric;
  _passed   boolean;
  _stages   int;
  _next     int;
  _trigger  text;
  _solid    boolean := false;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF _total IS NULL OR _total <= 0 THEN
    RAISE EXCEPTION 'a revision check with no questions is not a result';
  END IF;

  _correct := LEAST(GREATEST(COALESCE(_correct, 0), 0), _total);

  SELECT * INTO _cs FROM public.chapter_state
   WHERE user_id = _uid AND chapter_id = _chapter_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'this chapter has no revision scheduled';
  END IF;

  SELECT s.id, s.school_id INTO _sid, _school
    FROM public.students s WHERE s.user_id = _uid LIMIT 1;

  _stage    := GREATEST(_cs.revision_stage, 1);
  _pass_thr := public._recovery_const('REVISION_PASS_THRESHOLD')::numeric;
  _stages   := public._recovery_const('REVISION_STAGES_TO_SOLID')::int;
  _rate     := round(_correct::numeric / _total, 4);
  _passed   := _rate >= _pass_thr;

  _trigger := CASE WHEN _cs.recovered_at IS NOT NULL THEN 'recovery' ELSE 'engagement' END;

  INSERT INTO public.revision_sessions (
    user_id, student_id, school_id, chapter_id, stage,
    correct, total, passed, completed_at, triggered_by
  ) VALUES (
    _uid, COALESCE(_sid, _cs.student_id), COALESCE(_school, _cs.school_id),
    _chapter_id, _stage, _correct, _total, _passed, now(), _trigger
  );

  IF _passed THEN
    IF (_cs.consecutive_revision_passes + 1) >= _stages THEN
      _solid := true;
      UPDATE public.chapter_state SET
        consecutive_revision_passes = _cs.consecutive_revision_passes + 1,
        revision_stage = _stage,
        next_revision_at = NULL,
        state = 'recovered',
        updated_at = now()
      WHERE user_id = _uid AND chapter_id = _chapter_id;
    ELSE
      _next := public._revision_interval_days(_stage + 1);
      UPDATE public.chapter_state SET
        consecutive_revision_passes = _cs.consecutive_revision_passes + 1,
        revision_stage = _stage + 1,
        next_revision_at = now() + (_next || ' days')::interval,
        state = 'recovered',
        updated_at = now()
      WHERE user_id = _uid AND chapter_id = _chapter_id;
    END IF;
  ELSE
    _next := public._revision_interval_days(1);
    UPDATE public.chapter_state SET
      state = 'revision_failed',
      consecutive_revision_passes = 0,
      revision_stage = 1,
      next_revision_at = now() + (_next || ' days')::interval,
      updated_at = now()
    WHERE user_id = _uid AND chapter_id = _chapter_id;
  END IF;

  RETURN jsonb_build_object(
    'passed', _passed,
    'rate', _rate,
    'stage', _stage,
    'solid', _solid,
    'consecutive_passes', CASE WHEN _passed THEN _cs.consecutive_revision_passes + 1 ELSE 0 END,
    'stages_to_solid', _stages);
END;
$fn$;

COMMIT;
