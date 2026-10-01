-- ═══════════════════════════════════════════════════════════════════════════
-- WHAT ONLY THE OLD APP USED IS GONE
-- ═══════════════════════════════════════════════════════════════════════════
--
-- KNOWN_ISSUES 108, after the deploy of 2026-10-01 (main 63c6a636, measured
-- live: the served StudentDashboard chunk carries the new code and no call to
-- rpc_student_performance_charts). The owner: "do the post-deploy cleanup".
--
--   1. rpc_student_performance_charts — DROPPED. No caller in the app (Home,
--      the shell and LearningHub were its last), none in the database.
--   2. rpc_student_academic_snapshot's activity_heatmap key — REMOVED, with
--      the read behind it. No reader in the app. (The parent snapshot,
--      rpc_student_academic_snapshot_internal, keeps its own: it is called
--      only by rpc_parent_child_snapshot, which nothing calls — KNOWN 109.)
--   3. question_attempts.solution_viewed — DROPPED, with its writes in the
--      four functions that wrote it: rpc_record_question_attempt,
--      rpc_finish_practice_session, rpc_mirror_battle_answer and
--      _capture_battle_mistakes. Nothing read it; it recorded "the server
--      returned an explanation", which the question itself says.
--
-- NOT DROPPED, AND THE RECORD CORRECTED: question_attempts.attempt_number.
-- 108 called it "written, never read" and 20261132000000's header said no
-- function names it. Both were wrong — that query's function list was never
-- seen (the Management API returns only a batch's last result).
-- rpc_record_question_attempt READS it: for a question with no bank id, the
-- question's position in its session is the key that turns the finish RPC's
-- re-send of every attempt into an update instead of a second row. Its
-- 20261132000000 description ("the question's position in its practice
-- session") is exactly what makes it that key. It stays, and the proof below
-- requires it to keep working.
--
-- Old clients are safe: an app that still sends meta.solution_viewed or an
-- attempt's solution_viewed has it ignored (both arrive inside jsonb), and no
-- function signature changes.
--
-- ROLLBACK: rollback/20261135000000_what_only_the_old_app_used_is_gone.rollback.sql
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── What the rollback restores ─────────────────────────────────────────────
CREATE TABLE public.routines_pre_20261135000000 (
  object text PRIMARY KEY,
  definition text NOT NULL
);
ALTER TABLE public.routines_pre_20261135000000 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.routines_pre_20261135000000 FROM anon, authenticated;
COMMENT ON TABLE public.routines_pre_20261135000000 IS
  'Rollback source for 20261135000000: the six functions as they were. No policy and no grant to anon or authenticated. Drop once that deployment is accepted.';
INSERT INTO public.routines_pre_20261135000000 (object, definition)
SELECT o, pg_get_functiondef(o::regprocedure)
  FROM unnest(ARRAY[
    'public.rpc_student_performance_charts()',
    'public.rpc_student_academic_snapshot()',
    'public.rpc_record_question_attempt(jsonb,jsonb,boolean,jsonb,uuid,numeric,boolean,uuid,integer,uuid,boolean,text,jsonb)',
    'public.rpc_finish_practice_session(uuid,jsonb,boolean,boolean)',
    'public.rpc_mirror_battle_answer(uuid,uuid)',
    'public._capture_battle_mistakes(uuid)']) AS o;

CREATE TABLE public.question_attempts_solution_viewed_pre_20261135000000 (
  id uuid PRIMARY KEY
);
ALTER TABLE public.question_attempts_solution_viewed_pre_20261135000000 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.question_attempts_solution_viewed_pre_20261135000000 FROM anon, authenticated;
COMMENT ON TABLE public.question_attempts_solution_viewed_pre_20261135000000 IS
  'Rollback source for 20261135000000: the question_attempts rows whose solution_viewed was true. No policy and no grant to anon or authenticated. Drop once that deployment is accepted.';
INSERT INTO public.question_attempts_solution_viewed_pre_20261135000000 (id)
SELECT id FROM public.question_attempts WHERE solution_viewed;

-- ── 1. The charts RPC nothing calls ───────────────────────────────────────
DROP FUNCTION public.rpc_student_performance_charts();

-- ── 2 and 3. In-place edits, each anchor counted before it is replaced ─────
CREATE FUNCTION pg_temp.edit(_fn text, _old text, _new text, _expect int) RETURNS void
LANGUAGE plpgsql AS $f$
DECLARE _def text; _n int;
BEGIN
  _def := replace(pg_get_functiondef(_fn::regprocedure), E'\r\n', E'\n');
  _n := (length(_def) - length(replace(_def, _old, ''))) / length(_old);
  IF _n <> _expect THEN
    RAISE EXCEPTION '%: expected an anchor % time(s), found %: %', _fn, _expect, _n, left(_old, 80);
  END IF;
  EXECUTE replace(_def, _old, _new);
END
$f$;

SELECT pg_temp.edit('public.rpc_student_academic_snapshot()', $e0$  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'date', activity_date, 'test', test_count, 'homework', homework_count,
    'battles', battle_count, 'self_practice', self_practice_count, 'minutes', practice_minutes
  ) ORDER BY activity_date), '[]'::jsonb)
    INTO _heat FROM public.academic_daily_activity
    WHERE user_id = _uid AND activity_date >= CURRENT_DATE - 28;

$e0$, $e0$$e0$, 1);
SELECT pg_temp.edit('public.rpc_student_academic_snapshot()', $e1$    'activity_heatmap', _heat,
$e1$, $e1$$e1$, 1);
SELECT pg_temp.edit('public.rpc_student_academic_snapshot()', $e2$  _weak jsonb; _mistakes int; _heat jsonb;
$e2$, $e2$  _weak jsonb; _mistakes int;
$e2$, 1);
SELECT pg_temp.edit('public.rpc_record_question_attempt(jsonb,jsonb,boolean,jsonb,uuid,numeric,boolean,uuid,integer,uuid,boolean,text,jsonb)', $e3$        solution_viewed = solution_viewed OR _solution_viewed,
$e3$, $e3$$e3$, 2);
SELECT pg_temp.edit('public.rpc_record_question_attempt(jsonb,jsonb,boolean,jsonb,uuid,numeric,boolean,uuid,integer,uuid,boolean,text,jsonb)', $e4$    hint_used, solution_viewed, confidence, attempt_number, source, source_id,
$e4$, $e4$    hint_used, confidence, attempt_number, source, source_id,
$e4$, 1);
SELECT pg_temp.edit('public.rpc_record_question_attempt(jsonb,jsonb,boolean,jsonb,uuid,numeric,boolean,uuid,integer,uuid,boolean,text,jsonb)', $e5$    _solution_viewed,
$e5$, $e5$$e5$, 1);
SELECT pg_temp.edit('public.rpc_record_question_attempt(jsonb,jsonb,boolean,jsonb,uuid,numeric,boolean,uuid,integer,uuid,boolean,text,jsonb)', $e6$  _solution_viewed boolean := COALESCE((_m->>'solution_viewed')::boolean, false);
$e6$, $e6$$e6$, 1);
SELECT pg_temp.edit('public.rpc_finish_practice_session(uuid,jsonb,boolean,boolean)', $e7$            'solution_viewed', COALESCE((_att->>'solution_viewed')::boolean, false),
$e7$, $e7$$e7$, 1);
SELECT pg_temp.edit('public.rpc_mirror_battle_answer(uuid,uuid)', $e8$    hint_used, solution_viewed, source, source_id, practice_mode,
$e8$, $e8$    hint_used, source, source_id, practice_mode,
$e8$, 1);
SELECT pg_temp.edit('public.rpc_mirror_battle_answer(uuid,uuid)', $e9$    'medium',
    false,
    false,
    'battle',
$e9$, $e9$    'medium',
    false,
    'battle',
$e9$, 1);
SELECT pg_temp.edit('public._capture_battle_mistakes(uuid)', $e10$        hint_used, solution_viewed, source, source_id, practice_mode,
$e10$, $e10$        hint_used, source, source_id, practice_mode,
$e10$, 1);
SELECT pg_temp.edit('public._capture_battle_mistakes(uuid)', $e11$        'medium',
        false,
        false,
        'battle',
$e11$, $e11$        'medium',
        false,
        'battle',
$e11$, 1);

ALTER TABLE public.question_attempts DROP COLUMN solution_viewed;

-- ── THE PROOF ─────────────────────────────────────────────────────────────
--   1. the charts RPC is gone, no function names solution_viewed, the column
--      is gone — and attempt_number is still there;
--   2. a real student's snapshot has no activity_heatmap — CONTROL: it still
--      has exam_readiness and weak_topics;
--   3. every edited function RUNS, as its real caller, on every edited path
--      (PL/pgSQL checks an INSERT's columns only when it executes):
--      a. an answer to a bank question, sent twice, is one row;
--      b. a generated question, sent twice at position 1, is one row —
--         CONTROL: position 2 is a second row;
--      c. the finish re-sends both and still leaves exactly those rows;
--      d. a battle answer mirrors into an attempt, and the battle's mistakes
--         capture writes one again once it is removed.
-- Everything the proof creates is rolled back.
DO $proof$
DECLARE
  _uid uuid; _school uuid; _ps uuid; _q uuid; _snap jsonb; _n int;
  _bp_id uuid; _bp_user uuid; _battle uuid; _bq uuid; _aid uuid;
  _ans jsonb := '{"index": 0, "selected_index": 0}'::jsonb;
  _key jsonb := '{"index": 0}'::jsonb;
  _gen jsonb := '{"question": "proof generated question", "options": ["a", "b"]}'::jsonb;
BEGIN
  -- 1.
  IF to_regprocedure('public.rpc_student_performance_charts()') IS NOT NULL THEN
    RAISE EXCEPTION '1: rpc_student_performance_charts still exists';
  END IF;
  SELECT count(*) INTO _n FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace AND p.prokind IN ('f', 'p')
     AND pg_get_functiondef(p.oid) ~ 'solution_viewed';
  IF _n <> 0 THEN RAISE EXCEPTION '1: % function(s) still name solution_viewed', _n; END IF;
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.question_attempts'::regclass AND attname = 'solution_viewed' AND NOT attisdropped) THEN
    RAISE EXCEPTION '1: question_attempts.solution_viewed still exists';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.question_attempts'::regclass AND attname = 'attempt_number' AND NOT attisdropped) THEN
    RAISE EXCEPTION '1: attempt_number went too — it is the retry key';
  END IF;

  SELECT u.id, s.school_id INTO _uid, _school
    FROM auth.users u JOIN public.students s ON s.user_id = u.id
   WHERE u.email = 'qa.automation@wisdomcampus.com';
  IF _uid IS NULL THEN RAISE EXCEPTION 'NO FIXTURE: the QA student'; END IF;
  SELECT qb.id INTO _q FROM public.question_bank qb
   WHERE qb.is_active AND qb.is_approved AND qb.exam_id IS NULL AND qb.class_level = 10
   ORDER BY qb.id LIMIT 1;
  IF _q IS NULL THEN RAISE EXCEPTION 'NO FIXTURE: a Class 10 bank question'; END IF;

  SELECT ba.participant_id, bp.user_id, bp.battle_id, ba.question_id INTO _bp_id, _bp_user, _battle, _bq
    FROM public.battle_answers ba JOIN public.battle_participants bp ON bp.id = ba.participant_id
   ORDER BY ba.participant_id, ba.question_id LIMIT 1;
  IF _bp_id IS NULL THEN RAISE EXCEPTION 'NO FIXTURE: a battle answer'; END IF;

  BEGIN
    -- 2.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', _uid, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    _snap := public.rpc_student_academic_snapshot();
    RESET ROLE;
    IF _snap ? 'activity_heatmap' THEN RAISE EXCEPTION '2: the snapshot still sends activity_heatmap'; END IF;
    IF NOT (_snap ? 'exam_readiness' AND _snap ? 'weak_topics') THEN
      RAISE EXCEPTION '2: the snapshot lost a key it keeps (%)', (SELECT string_agg(k, ',') FROM jsonb_object_keys(_snap) k);
    END IF;

    -- 3a-c.
    INSERT INTO public.practice_sessions (user_id, subject, school_id) VALUES (_uid, 'Mathematics', _school) RETURNING id INTO _ps;
    SET LOCAL ROLE authenticated;
    PERFORM public.rpc_record_question_attempt(_key, '{}'::jsonb, false, _ans, _ps, 0, false, NULL, 1000, _q, false, 'practice', '{"solution_viewed": true}'::jsonb);
    PERFORM public.rpc_record_question_attempt(_key, '{}'::jsonb, false, _ans, _ps, 0, false, NULL, 1000, _q, false, 'practice', '{}'::jsonb);
    PERFORM public.rpc_record_question_attempt(_key, _gen, true, _ans, _ps, 1, false, NULL, 1000, NULL, false, 'practice', '{"attempt_number": 1}'::jsonb);
    PERFORM public.rpc_record_question_attempt(_key, _gen, true, _ans, _ps, 1, false, NULL, 1000, NULL, false, 'practice', '{"attempt_number": 1}'::jsonb);
    RESET ROLE;
    SELECT count(*) INTO _n FROM public.question_attempts WHERE session_id = _ps;
    IF _n <> 2 THEN RAISE EXCEPTION '3a/b: a re-sent answer made a second row (% rows, expected 2)', _n; END IF;

    SET LOCAL ROLE authenticated;
    PERFORM public.rpc_record_question_attempt(_key, _gen, true, _ans, _ps, 1, false, NULL, 1000, NULL, false, 'practice', '{"attempt_number": 2}'::jsonb);
    RESET ROLE;
    SELECT count(*) INTO _n FROM public.question_attempts WHERE session_id = _ps;
    IF _n <> 3 THEN RAISE EXCEPTION '3b CONTROL: position 2 did not make its own row (% rows)', _n; END IF;

    SET LOCAL ROLE authenticated;
    PERFORM public.rpc_finish_practice_session(_ps, jsonb_build_array(
      jsonb_build_object('bank_question_id', _q, 'selected_answer', _ans, 'correct_answer', _key, 'is_correct', false, 'solution_viewed', true),
      jsonb_build_object('generated_question', _gen, 'selected_answer', _ans, 'correct_answer', _key, 'is_correct', true, 'score', 1, 'attempt_number', 1)
    ), true, true);
    RESET ROLE;
    SELECT count(*) INTO _n FROM public.question_attempts WHERE session_id = _ps;
    IF _n <> 3 THEN RAISE EXCEPTION '3c: the finish re-send changed the rows (% rows, expected 3)', _n; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.practice_sessions WHERE id = _ps AND finished_at IS NOT NULL) THEN
      RAISE EXCEPTION '3c: the session did not finish';
    END IF;

    -- 3d.
    DELETE FROM public.question_attempts
     WHERE user_id = _bp_user AND source = 'battle' AND source_id = _battle;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', _bp_user, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    _aid := public.rpc_mirror_battle_answer(_bp_id, _bq);
    RESET ROLE;
    IF _aid IS NULL OR NOT EXISTS (SELECT 1 FROM public.question_attempts WHERE id = _aid) THEN
      RAISE EXCEPTION '3d: the battle answer did not mirror into an attempt';
    END IF;
    DELETE FROM public.question_attempts WHERE id = _aid;
    PERFORM public._capture_battle_mistakes(_bp_id);
    IF NOT EXISTS (SELECT 1 FROM public.question_attempts WHERE user_id = _bp_user AND source = 'battle' AND source_id = _battle) THEN
      RAISE EXCEPTION '3d: the battle capture wrote no attempt';
    END IF;

    PERFORM set_config('request.jwt.claims', NULL, true);
    RAISE EXCEPTION 'CLEANUP_PROOF_OK';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'CLEANUP_PROOF_OK' THEN RAISE; END IF;
  END;
END
$proof$;

NOTIFY pgrst, 'reload schema';

INSERT INTO public.schema_migrations (version)
VALUES ('20261135000000_what_only_the_old_app_used_is_gone')
ON CONFLICT (version) DO NOTHING;

COMMIT;
