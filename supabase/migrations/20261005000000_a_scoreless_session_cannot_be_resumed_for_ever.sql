-- ═══════════════════════════════════════════════════════════════════════════
-- A scoreless session cannot be resumed for ever
--
-- Two changes made in the last hour combined into a trap:
--
--   20261001000000 made scoring evidence-based, and refuses a recovery
--     session whose `plan` is NULL — a row started before the ladder was
--     stored cannot be scored from evidence, and guessing is the thing that
--     migration exists to stop.
--
--   20261003000000 made a second start RESUME the open session rather than
--     opening another and burning a §4.6 round.
--
-- Together: a student holding an unfinished PRE-plan session resumes it on
-- every start, and every submit refuses it. Recovery becomes permanently
-- unreachable for that chapter — a worse outcome than either problem alone.
--
-- Found by re-running the attack suite after the fixes, which failed on
-- exactly this before reaching its first assertion.
--
-- The resume branch now only hands back a session it is possible to score.
-- The pre-plan rows are removed rather than left: measured, there is 1 of
-- them across the whole database, on 1 student, and NONE of them carries an
-- outcome — they are sessions that were opened and never scored, so nothing
-- is being erased except an empty shell that would otherwise sit in front of
-- that student for ever and inflate `rounds_taken` on the screen.
--
-- Reverse: supabase/migrations/rollback/20261005000000_a_scoreless_session_cannot_be_resumed_for_ever.rollback.sql
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $fix$
DECLARE _def text; _new text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO _def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public' AND p.prokind='f' AND p.proname='rpc_start_recovery_session';
  IF md5(_def) <> '71a1b83849a4ba80e0e1d5b0612f33be' THEN
    RAISE EXCEPTION 'rpc_start_recovery_session is not the expected body (live md5 %)', md5(_def);
  END IF;
  _def := replace(_def, E'\r\n', E'\n');

  _new := replace(_def,
$old$   WHERE rs.user_id = _uid AND rs.chapter_id = _chapter_id AND rs.completed_at IS NULL$old$,
$new$   WHERE rs.user_id = _uid AND rs.chapter_id = _chapter_id AND rs.completed_at IS NULL
     -- Only a session that can still be SCORED is worth resuming. A pre-plan
     -- row cannot be, and handing it back on every start would put the
     -- student in front of a session that always refuses.
     AND rs.plan IS NOT NULL$new$);
  IF _new = _def THEN RAISE EXCEPTION 'could not find the resume lookup'; END IF;

  EXECUTE _new;
  RAISE NOTICE 'only a scorable session is resumed';
END
$fix$;

-- The shells themselves. No outcome, no plan, nothing to preserve.
DELETE FROM public.recovery_sessions
 WHERE plan IS NULL AND completed_at IS NULL AND outcome IS NULL;

-- ── Prove a student who HAD one can start again ─────────────────────────────
-- G11: the proof manufactures the exact trap — an unfinished, plan-less row —
-- and requires start to get past it. Against the previous body this raises
-- "predates evidence-based scoring" or hands back the unscorable row.
DO $prove$
DECLARE
  _uid uuid; _chap uuid; _sid uuid; _school uuid; _stuck uuid; _a jsonb; _n int;
BEGIN
  BEGIN
    SELECT sm.user_id, sm.chapter_id INTO _uid, _chap
      FROM public.student_mistakes sm
     WHERE sm.status='open' AND sm.chapter_id IS NOT NULL AND sm.question_id IS NOT NULL
     GROUP BY 1,2 HAVING count(*) >= public._recovery_const('RECOVERY_TRIGGER_COUNT')::int
     ORDER BY count(*) DESC LIMIT 1;
    IF _uid IS NULL THEN RAISE EXCEPTION 'nobody is at the trigger'; END IF;

    SELECT s.id, s.school_id INTO _sid, _school FROM public.students s WHERE s.user_id=_uid LIMIT 1;

    INSERT INTO public.recovery_sessions
      (user_id, student_id, school_id, chapter_id, round,
       tier0_total, tier1_total, tier2_total, tier3_total, plan)
    VALUES (_uid, _sid, _school, _chap, 99, 2, 0, 0, 2, NULL)
    RETURNING id INTO _stuck;

    PERFORM set_config('request.jwt.claims', json_build_object('sub', _uid)::text, true);

    _a := public.rpc_start_recovery_session(_chap);

    IF NOT COALESCE((_a->>'started')::boolean, false) THEN
      RAISE EXCEPTION 'a student holding a pre-plan session still cannot start: %', _a;
    END IF;
    IF (_a->>'session_id')::uuid = _stuck THEN
      RAISE EXCEPTION 'start resumed the unscorable session';
    END IF;
    IF (SELECT plan IS NULL FROM public.recovery_sessions WHERE id = (_a->>'session_id')::uuid) THEN
      RAISE EXCEPTION 'the new session has no plan either';
    END IF;

    -- and a second tap must still resume THAT one, not open a third
    IF (public.rpc_start_recovery_session(_chap)->>'session_id')::uuid
       IS DISTINCT FROM (_a->>'session_id')::uuid THEN
      RAISE EXCEPTION 'the resume behaviour from 20261003000000 was lost';
    END IF;

    SELECT count(*) INTO _n FROM public.recovery_sessions
     WHERE user_id=_uid AND chapter_id=_chap AND completed_at IS NULL AND plan IS NOT NULL;
    IF _n <> 1 THEN RAISE EXCEPTION 'expected one scorable open session, found %', _n; END IF;

    RAISE EXCEPTION 'ROLLBACK_AFTER_PROOF';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'ROLLBACK_AFTER_PROOF' THEN
      RAISE NOTICE 'a pre-plan session no longer blocks recovery, and resume still resumes';
    ELSE
      RAISE;
    END IF;
  END;
END
$prove$;

COMMIT;
