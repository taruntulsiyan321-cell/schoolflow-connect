-- probe49: a session's analysis context (20261143000000), asked as the people at it.
--
-- rpc_session_analysis_context(session) is SECURITY DEFINER, so its fence is
-- its own body: every row it reads must be the caller's. The fixture puts a
-- second student's session on the SAME subject and chapter between the first
-- student's two sessions, and has that second student answer the same question
-- right — so a body that forgot `user_id = _uid` anywhere would pick the
-- stranger's session as "last time", or the stranger's answer as "earlier".
--
-- THE CLAIMS
--   1. the student reads their own session's context; "last time" is THEIR
--      session just before, not the other student's later one.  (POSITIVE CONTROL + the fence)
--   2. "earlier" holds the student's own last answer to the question
--      (wrong), not the other student's (right).                      <- the fence
--   3. another student asking for that session is told it is not found. <- the fence
--   4. signed out, the function cannot be called.                       <- the grant
--   5. with no identity, it refuses.                                    <- the rule
--
-- Every write is rolled back.
BEGIN;
SET LOCAL statement_timeout = '120s';
CREATE TEMP TABLE probe(n serial, area text, role_tested text, expected text, observed text, verdict text) ON COMMIT DROP;

CREATE FUNCTION pg_temp.as_user(_uid uuid, _sql text) RETURNS text
LANGUAGE plpgsql AS $fn$
DECLARE _out text;
BEGIN
  PERFORM set_config('request.jwt.claims', CASE WHEN _uid IS NULL THEN json_build_object('role','authenticated')::text
                                                ELSE json_build_object('sub',_uid,'role','authenticated')::text END, true);
  PERFORM set_config('role','authenticated', true);
  BEGIN
    EXECUTE _sql INTO _out;
    PERFORM set_config('role','postgres', true);
    RETURN 'OK: ' || coalesce(_out,'null');
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('role','postgres', true);
    RETURN 'ERROR: ' || SQLERRM;
  END;
END $fn$;

CREATE FUNCTION pg_temp.as_anon(_sql text) RETURNS text
LANGUAGE plpgsql AS $fn$
DECLARE _out text;
BEGIN
  PERFORM set_config('request.jwt.claims', NULL, true);
  PERFORM set_config('role','anon', true);
  BEGIN
    EXECUTE _sql INTO _out;
    PERFORM set_config('role','postgres', true);
    RETURN 'OK: ' || coalesce(_out,'null');
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('role','postgres', true);
    RETURN 'ERROR: ' || SQLERRM;
  END;
END $fn$;

DO $probe$
DECLARE
  a uuid; a_school uuid; b uuid; b_school uuid; q uuid;
  prev uuid; cur uuid; theirs uuid; r text;
BEGIN
  SELECT st.user_id, st.school_id INTO a, a_school
    FROM public.students st JOIN public.schools s ON s.id = st.school_id AND s.kind = 'individual'
   WHERE st.user_id IS NOT NULL ORDER BY st.user_id LIMIT 1;
  SELECT st.user_id, st.school_id INTO b, b_school
    FROM public.students st JOIN public.schools s ON s.id = st.school_id AND s.kind = 'individual'
   WHERE st.user_id IS NOT NULL AND st.user_id <> a ORDER BY st.user_id LIMIT 1;
  SELECT id INTO q FROM public.question_bank WHERE is_active AND correct_index IS NOT NULL ORDER BY id LIMIT 1;
  IF a IS NULL OR b IS NULL OR q IS NULL THEN
    INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
      ('fixture: two individual students and a question','-','all three','not found','FAIL');
    RETURN;
  END IF;

  -- a: a session two days ago (wrong on q), and the one being read, a day ago (right on q).
  -- b: a session on the same chapter a day and a half ago — between a's two — right on q.
  INSERT INTO public.practice_sessions (user_id, school_id, subject, chapter, question_count, finished_at, created_at) VALUES
    (a, a_school, 'Probe 49', 'Chapter 49', 1, now() - interval '2 days', now() - interval '2 days') RETURNING id INTO prev;
  INSERT INTO public.practice_sessions (user_id, school_id, subject, chapter, question_count, finished_at, created_at) VALUES
    (a, a_school, 'Probe 49', 'Chapter 49', 1, now() - interval '1 day', now() - interval '1 day') RETURNING id INTO cur;
  INSERT INTO public.practice_sessions (user_id, school_id, subject, chapter, question_count, finished_at, created_at) VALUES
    (b, b_school, 'Probe 49', 'Chapter 49', 1, now() - interval '36 hours', now() - interval '36 hours') RETURNING id INTO theirs;
  INSERT INTO public.question_attempts (user_id, school_id, session_id, bank_question_id, generated_question, correct_answer, is_correct, skipped, created_at, time_taken_ms) VALUES
    (a, a_school, prev,   q, '{"topic":"Probe 49"}', '{}', false, false, now() - interval '2 days', 9000),
    (a, a_school, cur,    q, '{"topic":"Probe 49"}', '{}', true,  false, now() - interval '1 day', 8000),
    (b, b_school, theirs, q, '{"topic":"Probe 49"}', '{}', true,  false, now() - interval '36 hours', 7000);

  -- 1.
  r := pg_temp.as_user(a, format($q$SELECT CASE (public.rpc_session_analysis_context(%L)->'previous'->>'id')
                                   WHEN %L THEN 'their own session before' WHEN %L THEN 'THE OTHER STUDENT''S SESSION'
                                   ELSE coalesce(public.rpc_session_analysis_context(%L)->'previous'->>'id', 'none') END$q$,
                                 cur, prev, theirs, cur));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('reads their own session; last time is their own session before (positive control)','student (owner)',
     'OK: their own session before', r, CASE WHEN r = 'OK: their own session before' THEN 'PASS' ELSE 'FAIL' END);
  -- 2.
  r := pg_temp.as_user(a, format($q$SELECT string_agg(e->>'bank_question_id' || '=' || (e->>'is_correct'), ',')
                                   FROM jsonb_array_elements(public.rpc_session_analysis_context(%L)->'earlier') e$q$, cur));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('earlier answer to the question is their own (wrong), not the other student''s (right)','student (owner)',
     'OK: ' || q || '=false', r, CASE WHEN r = 'OK: ' || q || '=false' THEN 'PASS' ELSE 'FAIL' END);
  -- 3.
  r := pg_temp.as_user(b, format($q$SELECT public.rpc_session_analysis_context(%L)::text$q$, cur));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('reads another student''s session','another student','ERROR: session not found', r,
     CASE WHEN r = 'ERROR: session not found' THEN 'PASS' ELSE 'FAIL' END);
  -- 4.
  r := pg_temp.as_anon(format($q$SELECT public.rpc_session_analysis_context(%L)::text$q$, cur));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('reads a session signed out','anon','ERROR: permission denied for function', r,
     CASE WHEN r LIKE 'ERROR:%permission denied for function rpc_session_analysis_context%' THEN 'PASS' ELSE 'FAIL' END);
  -- 5.
  r := pg_temp.as_user(NULL, format($q$SELECT public.rpc_session_analysis_context(%L)::text$q$, cur));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('reads a session with no identity','authenticated, no sub','ERROR: auth required', r,
     CASE WHEN r = 'ERROR: auth required' THEN 'PASS' ELSE 'FAIL' END);
END $probe$;

SELECT area, role_tested, expected, observed, verdict FROM probe ORDER BY n;
ROLLBACK;
