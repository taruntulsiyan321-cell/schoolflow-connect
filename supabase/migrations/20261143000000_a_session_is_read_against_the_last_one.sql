-- ═══════════════════════════════════════════════════════════════════════════
-- A SESSION IS READ AGAINST THE LAST ONE, AND AGAINST THE EXAM
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Owner, 2026-10-03: analysis is the differentiator. After a session the
-- student is shown, besides what the session itself holds, how it compares
-- with their last session on the same chapter, which questions they got wrong
-- before and right now (or wrong again), and what it would have scored on the
-- real paper.
--
-- rpc_session_analysis_context(session) returns what the session's own
-- attempts cannot:
--   paper     the CUET paper's shape — _mock_paper(), the one place it is
--             stated (questions, minutes, +marks, −marks)
--   previous  the student's last finished session on the same subject and
--             chapter before this one, with its attempts (topic, right,
--             skipped, timed out, time, left out of accuracy)
--   earlier   for each bank question in this session, the student's latest
--             answer to it before this session began
-- The arithmetic on them is src/academic/metrics/sessionAnalysis.ts.
--
-- OWNER-scoped: the session must be the caller's, and every row read is
-- theirs (§10.8 — practice is private to the student).
--
-- ROLLBACK: rollback/20261143000000_a_session_is_read_against_the_last_one.rollback.sql
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE FUNCTION public.rpc_session_analysis_context(_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  _uid   uuid := auth.uid();
  _s     public.practice_sessions%ROWTYPE;
  _prev  public.practice_sessions%ROWTYPE;
  _began timestamptz;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'auth required' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO _s FROM public.practice_sessions WHERE id = _session_id AND user_id = _uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'session not found' USING ERRCODE = 'P0002';
  END IF;

  -- The last finished session on the same chapter, before this one. A session
  -- with no single chapter (the targeted modes) has none to compare with.
  IF coalesce(btrim(_s.chapter), '') <> '' THEN
    SELECT * INTO _prev
      FROM public.practice_sessions p
     WHERE p.user_id = _uid
       AND p.id <> _s.id
       AND p.subject = _s.subject
       AND p.chapter = _s.chapter
       AND p.finished_at IS NOT NULL
       AND p.finished_at < coalesce(_s.finished_at, now())
       AND EXISTS (SELECT 1 FROM public.question_attempts qa
                    WHERE qa.session_id = p.id AND qa.user_id = _uid AND NOT qa.skipped)
     ORDER BY p.finished_at DESC, p.id
     LIMIT 1;
  END IF;

  SELECT min(qa.created_at) INTO _began
    FROM public.question_attempts qa
   WHERE qa.session_id = _s.id AND qa.user_id = _uid;

  RETURN jsonb_build_object(
    'paper', (SELECT jsonb_build_object('questions', m->'questions', 'minutes', m->'minutes',
                                        'marks_correct', m->'marks_correct', 'marks_wrong', m->'marks_wrong')
                FROM (SELECT public._mock_paper() AS m) x),
    'previous', CASE WHEN _prev.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', _prev.id,
      'finished_at', _prev.finished_at,
      'practice_mode', _prev.practice_mode,
      'attempts', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                     'topic', qa.generated_question->>'topic',
                     'is_correct', qa.is_correct,
                     'skipped', qa.skipped,
                     'timed_out', qa.timed_out,
                     'time_taken_ms', qa.time_taken_ms,
                     'excluded', qa.excluded_from_accuracy) ORDER BY qa.created_at, qa.id), '[]'::jsonb)
                     FROM public.question_attempts qa
                    WHERE qa.session_id = _prev.id AND qa.user_id = _uid)) END,
    'earlier', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                  'bank_question_id', e.bank_question_id, 'is_correct', e.is_correct,
                  'skipped', e.skipped, 'at', e.created_at)), '[]'::jsonb)
                  FROM (SELECT DISTINCT ON (qa.bank_question_id) qa.bank_question_id, qa.is_correct, qa.skipped, qa.created_at
                          FROM public.question_attempts qa
                         WHERE qa.user_id = _uid
                           AND qa.session_id IS DISTINCT FROM _s.id
                           AND _began IS NOT NULL
                           AND qa.created_at < _began
                           AND NOT qa.excluded_from_accuracy
                           AND qa.bank_question_id IN (SELECT q2.bank_question_id FROM public.question_attempts q2
                                                        WHERE q2.session_id = _s.id AND q2.user_id = _uid
                                                          AND q2.bank_question_id IS NOT NULL)
                         ORDER BY qa.bank_question_id, qa.created_at DESC) e)
  );
END $fn$;

REVOKE ALL ON FUNCTION public.rpc_session_analysis_context(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_session_analysis_context(uuid) TO authenticated;

COMMENT ON FUNCTION public.rpc_session_analysis_context(uuid) IS
  'What a session''s result screen needs beyond its own attempts: the CUET paper''s shape, the last session on the same chapter, and each question''s earlier answer (20261143000000). Owner-scoped.';

-- ── VERIFY ──────────────────────────────────────────────────────────────────
DO $verify$
BEGIN
  IF NOT has_function_privilege('authenticated', 'public.rpc_session_analysis_context(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.rpc_session_analysis_context(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'VERIFY FAILED: the session context is shut to students or open to strangers';
  END IF;
END $verify$;

-- ── PROOF: as the students themselves; rolled back ─────────────────────────
DO $proof$
DECLARE
  _fail text := '';
  _sentinel constant text := 'm20261143 proof rolled back';
  _a uuid; _a_school uuid; _b uuid; _q1 uuid; _q2 uuid; _q3 uuid;
  _old uuid; _prev uuid; _cur uuid; _other uuid; _later uuid;
  _r jsonb; _err text;
BEGIN
  SELECT st.user_id, st.school_id INTO _a, _a_school
    FROM public.students st JOIN public.schools s ON s.id = st.school_id AND s.kind = 'individual'
   WHERE st.user_id IS NOT NULL ORDER BY st.user_id LIMIT 1;
  SELECT st.user_id INTO _b FROM public.students st
   WHERE st.user_id IS NOT NULL AND st.user_id <> _a ORDER BY st.user_id LIMIT 1;
  SELECT id INTO _q1 FROM public.question_bank WHERE is_active AND correct_index IS NOT NULL ORDER BY id LIMIT 1;
  SELECT id INTO _q2 FROM public.question_bank WHERE is_active AND correct_index IS NOT NULL AND id > _q1 ORDER BY id LIMIT 1;
  SELECT id INTO _q3 FROM public.question_bank WHERE is_active AND correct_index IS NOT NULL AND id > _q2 ORDER BY id LIMIT 1;
  IF _a IS NULL OR _b IS NULL OR _q3 IS NULL THEN
    RAISE EXCEPTION 'PROOF FAILED: fixture missing (a % b % q %)', _a, _b, _q2;
  END IF;

  BEGIN
    -- Four sessions of the probe's chapter: an older one, the one just before,
    -- the one being read, and one finished after it; and one of another chapter.
    INSERT INTO public.practice_sessions (user_id, school_id, subject, chapter, question_count, finished_at, created_at) VALUES
      (_a, _a_school, 'Probe 20261143', 'Chapter P', 2, now() - interval '3 days', now() - interval '3 days') RETURNING id INTO _old;
    INSERT INTO public.practice_sessions (user_id, school_id, subject, chapter, question_count, finished_at, created_at) VALUES
      (_a, _a_school, 'Probe 20261143', 'Chapter P', 2, now() - interval '2 days', now() - interval '2 days') RETURNING id INTO _prev;
    INSERT INTO public.practice_sessions (user_id, school_id, subject, chapter, question_count, finished_at, created_at) VALUES
      (_a, _a_school, 'Probe 20261143', 'Chapter P', 2, now() - interval '1 day', now() - interval '1 day') RETURNING id INTO _cur;
    INSERT INTO public.practice_sessions (user_id, school_id, subject, chapter, question_count, finished_at, created_at) VALUES
      (_a, _a_school, 'Probe 20261143', 'Chapter P', 2, now() - interval '1 hour', now() - interval '1 hour') RETURNING id INTO _later;
    INSERT INTO public.practice_sessions (user_id, school_id, subject, chapter, question_count, finished_at, created_at) VALUES
      (_a, _a_school, 'Probe 20261143', 'Chapter Q', 2, now() - interval '30 hours', now() - interval '30 hours') RETURNING id INTO _other;
    INSERT INTO public.question_attempts (user_id, school_id, session_id, bank_question_id, generated_question, correct_answer, is_correct, skipped, created_at, time_taken_ms) VALUES
      (_a, _a_school, _old,   _q1, '{"topic":"T old"}',  '{}', false, false, now() - interval '3 days', 9000),
      (_a, _a_school, _prev,  _q1, '{"topic":"T prev"}', '{}', false, false, now() - interval '2 days', 8000),
      (_a, _a_school, _prev,  _q2, '{"topic":"T prev"}', '{}', true,  false, now() - interval '2 days', 7000),
      (_a, _a_school, _cur,   _q1, '{"topic":"T cur"}',  '{}', true,  false, now() - interval '1 day', 6000),
      (_a, _a_school, _cur,   _q2, '{"topic":"T cur"}',  '{}', false, false, now() - interval '1 day', 5000),
      (_a, _a_school, _later, _q1, '{"topic":"T later"}', '{}', true, false, now() - interval '1 hour', 4000),
      -- Between the previous session and this one, on a question this one did not ask.
      (_a, _a_school, _other, _q3, '{"topic":"T other"}', '{}', true, false, now() - interval '30 hours', 3000);

    PERFORM set_config('request.jwt.claims', json_build_object('sub', _a, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    _r := public.rpc_session_analysis_context(_cur);
    EXECUTE 'RESET ROLE';

    -- 1. The paper is _mock_paper()'s.
    IF (_r->'paper'->>'questions')::int <> 50 OR (_r->'paper'->>'marks_wrong')::int <> -1 THEN
      _fail := _fail || ' [1 paper ' || coalesce(_r->>'paper', 'null') || ']';
    END IF;
    -- 2. The last one before, of the same chapter: not the older, not the later, not the other chapter.
    IF (_r->'previous'->>'id')::uuid IS DISTINCT FROM _prev THEN
      _fail := _fail || ' [2 previous is ' || coalesce(_r->'previous'->>'id', 'none') || ', not the one just before]';
    ELSIF jsonb_array_length(_r->'previous'->'attempts') <> 2 OR _r->'previous'->'attempts'->0->>'topic' <> 'T prev' THEN
      _fail := _fail || ' [2 previous attempts ' || (_r->'previous'->'attempts')::text || ']';
    END IF;
    -- 3. Each question's latest earlier answer: q1 wrong (in _prev, not _old), q2 right — never the later session's.
    IF (SELECT (e->>'is_correct')::boolean FROM jsonb_array_elements(_r->'earlier') e WHERE (e->>'bank_question_id')::uuid = _q1) IS DISTINCT FROM false
       OR (SELECT (e->>'is_correct')::boolean FROM jsonb_array_elements(_r->'earlier') e WHERE (e->>'bank_question_id')::uuid = _q2) IS DISTINCT FROM true
       OR jsonb_array_length(_r->'earlier') <> 2 THEN
      _fail := _fail || ' [3 earlier ' || (_r->'earlier')::text || ']';
    END IF;
    -- 4. Another student, and a stranger, read nothing of it.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', _b, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    BEGIN
      PERFORM public.rpc_session_analysis_context(_cur);
      _fail := _fail || ' [4 another student read the session]';
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM <> 'session not found' THEN _fail := _fail || ' [4 ' || SQLERRM || ']'; END IF;
    END;
    EXECUTE 'RESET ROLE';
    PERFORM set_config('request.jwt.claims', NULL, true);
    EXECUTE 'SET LOCAL ROLE anon';
    BEGIN
      PERFORM public.rpc_session_analysis_context(_cur);
      _fail := _fail || ' [4 a stranger read the session]';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    EXECUTE 'RESET ROLE';
    -- 5. A session with no single chapter has nothing to compare with.
    UPDATE public.practice_sessions SET chapter = '' WHERE id = _cur;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', _a, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    _r := public.rpc_session_analysis_context(_cur);
    EXECUTE 'RESET ROLE';
    IF _r->'previous' <> 'null'::jsonb THEN _fail := _fail || ' [5 a chapterless session found a previous one]'; END IF;

    RAISE EXCEPTION USING MESSAGE = _sentinel;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> _sentinel THEN
      RAISE EXCEPTION 'PROOF FAILED (unexpected %): %', SQLSTATE, SQLERRM;
    END IF;
  END;

  IF _fail <> '' THEN
    RAISE EXCEPTION 'PROOF FAILED:%', _fail;
  END IF;
END $proof$;

COMMIT;
