-- ═══════════════════════════════════════════════════════════════════════════
-- A revision check says what happened
--
-- The recovery result screen tells a student both halves of §4.2b, which rung
-- they are on and when the next check is. The revision result screen told them
-- nothing at all: Practice.tsx computed `results.revision` from
-- rpc_submit_revision_session and then dropped it — handleFinish forwarded
-- `recovery` to the result page and not `revision`, and no summary rendered
-- it either. The field's own docblock said it existed "so the result screen
-- reports what actually happened"; nothing read it.
--
-- Fixing that is a client change, and it is made in the same commit. One thing
-- had to move server-side first: the outcome carried no date, so a screen
-- could say "passed" but not "come back on the 21st" — and the only way for
-- the client to put a date on it would be to add the 7/21/60 intervals to a
-- second home. §5.3's ladder lives in recovery_constants and the server reads
-- it, so the server returns the date it just wrote.
--
--   next_revision_at  the date now on chapter_state. NULL is meaningful and
--                     is exactly what `solid` means: three consecutive passes
--                     and the chapter leaves the queue, which it does BY
--                     having no next date, not by a flag.
--   state             the chapter's state after this check ('recovered' or
--                     'revision_failed'), so the screen quotes the engine
--                     rather than inferring it from `passed`.
--
-- `stage` already in the return is the rung this check WAS FOR, not the next
-- one — after a pass at rung 1, chapter_state.revision_stage is 2 and this
-- returns 1. That is the useful one for a sentence about what just happened,
-- and the client type now says so.
--
-- Reverse: supabase/migrations/rollback/20260927000000_a_revision_check_says_what_happened.rollback.sql
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- G11: this can fail. The body below is the live one as of writing, read with
-- pg_get_functiondef; if it has moved, this aborts rather than reverting
-- somebody else's change.
DO $precheck$
DECLARE _got text;
BEGIN
  SELECT md5(pg_get_functiondef(p.oid)) INTO _got
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.prokind = 'f'
     AND p.proname = 'rpc_submit_revision_session';

  IF _got IS NULL THEN
    RAISE EXCEPTION 'precheck: rpc_submit_revision_session does not exist';
  ELSIF _got <> '0055993f1f6491ac3cdf80a36a9c4011' THEN
    RAISE EXCEPTION
      'precheck: rpc_submit_revision_session has changed since this migration was written (live md5 %)', _got;
  END IF;
END
$precheck$;

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
  _next_at  timestamptz;
  _state    text;
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

  -- §5.2 vs §5.1: a chapter that has been through recovery is revising
  -- because of it; one that only ever met the engagement floor is not.
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
      -- §5.3: "pass all three and the chapter leaves the queue." No next
      -- date, which is what makes it leave — not a flag a screen has to know
      -- to check.
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
    -- §5.5: a failed check sends the chapter back and restarts the ladder.
    -- The streak resets to zero, not to one — three CONSECUTIVE passes.
    _next := public._revision_interval_days(1);
    UPDATE public.chapter_state SET
      state = 'revision_failed',
      consecutive_revision_passes = 0,
      revision_stage = 1,
      next_revision_at = now() + (_next || ' days')::interval,
      updated_at = now()
    WHERE user_id = _uid AND chapter_id = _chapter_id;
  END IF;

  -- Read back rather than rebuilt from the branch above: the screen is told
  -- what the row SAYS, so a future change to one of those three UPDATEs
  -- cannot leave the student looking at a date the engine did not write.
  SELECT cs.next_revision_at, cs.state
    INTO _next_at, _state
    FROM public.chapter_state cs
   WHERE cs.user_id = _uid AND cs.chapter_id = _chapter_id;

  RETURN jsonb_build_object(
    'passed', _passed,
    'rate', _rate,
    -- The rung this check was FOR, not the one it moved to.
    'stage', _stage,
    'solid', _solid,
    'consecutive_passes', CASE WHEN _passed THEN _cs.consecutive_revision_passes + 1 ELSE 0 END,
    'stages_to_solid', _stages,
    'next_revision_at', _next_at,
    'state', _state);
END;
$fn$;

-- ── Prove the three outcomes, against a real student, rolled back ───────────
-- G11: each branch is driven and asserted. A return that hardcoded
-- next_revision_at, or that omitted it on the solid branch, fails here — the
-- solid case requires NULL and the other two require a date the ladder
-- actually schedules.
DO $prove$
DECLARE
  _uid  uuid;
  _chap uuid;
  _out  jsonb;
  _days numeric;
  _stages int := public._recovery_const('REVISION_STAGES_TO_SOLID')::int;
  _i    int;
BEGIN
  -- The proof WRITES: it drives three real revision checks. Those writes must
  -- not survive, and the function replacement above must. An inner block is
  -- an implicit savepoint, so raising the sentinel at the end of it discards
  -- everything the block wrote and leaves the CREATE OR REPLACE standing.
  -- Anything that is NOT the sentinel is re-raised, and aborts the migration.
  BEGIN
  SELECT cs.user_id, cs.chapter_id INTO _uid, _chap
    FROM public.chapter_state cs
   ORDER BY cs.updated_at DESC
   LIMIT 1;

  IF _uid IS NULL THEN
    -- Make one the honest way: take a student at the trigger through a real
    -- recovery. A skipped check is not a passing check.
    SELECT sm.user_id, sm.chapter_id INTO _uid, _chap
      FROM public.student_mistakes sm
     WHERE sm.status = 'open' AND sm.chapter_id IS NOT NULL AND sm.question_id IS NOT NULL
     GROUP BY sm.user_id, sm.chapter_id
    HAVING count(*) >= public._recovery_const('RECOVERY_TRIGGER_COUNT')::int
     ORDER BY count(*) DESC
     LIMIT 1;

    IF _uid IS NULL THEN
      RAISE EXCEPTION 'no chapter_state anywhere and nobody at the trigger: this could not be exercised';
    END IF;
  END IF;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', _uid)::text, true);

  -- Put the chapter on the first rung, whatever it was on before.
  INSERT INTO public.chapter_state (user_id, student_id, school_id, chapter_id, state,
                                    recovered_at, next_revision_at, revision_stage,
                                    consecutive_revision_passes)
  SELECT _uid, s.id, s.school_id, _chap, 'recovered', now(),
         now() + (public._revision_interval_days(1) || ' days')::interval, 1, 0
    FROM public.students s WHERE s.user_id = _uid LIMIT 1
  ON CONFLICT (user_id, chapter_id) DO UPDATE SET
    state = 'recovered', recovered_at = now(), revision_stage = 1,
    consecutive_revision_passes = 0,
    next_revision_at = now() + (public._revision_interval_days(1) || ' days')::interval;

  -- 1. a pass that is not the last one
  _out := public.rpc_submit_revision_session(_chap, 8, 8);
  _days := EXTRACT(EPOCH FROM ((_out->>'next_revision_at')::timestamptz - now())) / 86400.0;
  IF NOT (_out->>'passed')::boolean
     OR (_out->>'solid')::boolean
     OR (_out->>'stage')::int <> 1
     OR _out->>'state' <> 'recovered'
     OR _days NOT BETWEEN 20.9 AND 21.1 THEN
    RAISE EXCEPTION 'pass branch wrong: %', _out;
  END IF;

  -- 2. keep passing until solid; the last one must return a NULL date
  FOR _i IN 2.._stages LOOP
    _out := public.rpc_submit_revision_session(_chap, 8, 8);
  END LOOP;
  IF NOT (_out->>'solid')::boolean
     OR _out->>'next_revision_at' IS NOT NULL
     OR (_out->>'consecutive_passes')::int <> _stages THEN
    RAISE EXCEPTION 'solid branch wrong (expected no next date after % passes): %', _stages, _out;
  END IF;

  -- 3. a failure restarts the ladder at interval 1
  UPDATE public.chapter_state SET
    next_revision_at = now(), revision_stage = 2, consecutive_revision_passes = 1
   WHERE user_id = _uid AND chapter_id = _chap;
  _out := public.rpc_submit_revision_session(_chap, 0, 8);
  _days := EXTRACT(EPOCH FROM ((_out->>'next_revision_at')::timestamptz - now())) / 86400.0;
  IF (_out->>'passed')::boolean
     OR _out->>'state' <> 'revision_failed'
     OR (_out->>'consecutive_passes')::int <> 0
     OR _days NOT BETWEEN 6.9 AND 7.1 THEN
    RAISE EXCEPTION 'fail branch wrong: %', _out;
  END IF;

  RAISE EXCEPTION 'ROLLBACK_AFTER_PROOF';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'ROLLBACK_AFTER_PROOF' THEN
      RAISE NOTICE 'all three revision branches return the date the engine wrote (pass -> 21d, solid -> null, fail -> 7d); the proof rows are rolled back';
    ELSE
      RAISE;
    END IF;
  END;
END
$prove$;

COMMIT;
