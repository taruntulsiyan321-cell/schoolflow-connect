-- probe48: question reports' doors (20261139000000), asked as the people at them.
--
-- A student files a report through rpc_report_question and reads it back; the
-- check that settles it goes through three server-only functions. §10.21: the
-- report goes to the AI, never to the school — and never to another student.
--
-- THE CLAIMS
--   1. a student files a report on a question they can be served.  (POSITIVE CONTROL)
--   2. they read their own report back.                             (POSITIVE CONTROL)
--   3. another student reads none of it.                                  <- the fence
--   4. a student cannot write a report row directly, not even their own. <- the grant
--   5. signed out, reports cannot be read, and none can be filed.        <- the grant
--   6. a student cannot claim reports, apply a verdict, or retire a
--      question — each refused for want of EXECUTE.                      <- the doors
--   7. a question the student cannot be served cannot be reported.       <- the rule
--
-- Every write is rolled back.
BEGIN;
SET LOCAL statement_timeout = '120s';
CREATE TEMP TABLE probe(n serial, area text, role_tested text, expected text, observed text, verdict text) ON COMMIT DROP;

CREATE FUNCTION pg_temp.as_user(_uid uuid, _sql text) RETURNS text
LANGUAGE plpgsql AS $fn$
DECLARE _out text;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub',_uid,'role','authenticated')::text, true);
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
  a uuid; b uuid; q uuid; hidden uuid; r text;
BEGIN
  -- a: an exam account, and a question of its own syllabus it can be served.
  SELECT st.user_id, qb.id INTO a, q
    FROM public.students st
    JOIN public.schools s ON s.id = st.school_id AND s.kind = 'individual'
    JOIN public.exam_accounts ea ON ea.school_id = st.school_id
    JOIN public.exam_syllabus_chapters sc ON sc.exam_id = ea.exam_id AND sc.stream = ea.stream
    JOIN public.question_bank qb ON qb.chapter_id = sc.chapter_id AND qb.exam_id = ea.exam_id
   WHERE st.user_id IS NOT NULL AND qb.is_active AND qb.is_approved AND qb.correct_index IS NOT NULL
     AND jsonb_typeof(qb.options) = 'array'
     AND NOT EXISTS (SELECT 1 FROM public.question_reports x WHERE x.user_id = st.user_id AND x.question_id = qb.id)
   ORDER BY st.user_id, qb.id LIMIT 1;
  SELECT st.user_id INTO b
    FROM public.students st JOIN public.schools s ON s.id = st.school_id AND s.kind = 'individual'
   WHERE st.user_id IS NOT NULL AND st.user_id <> a ORDER BY st.user_id LIMIT 1;
  SELECT id INTO hidden FROM public.question_bank
   WHERE exam_id IS NULL AND is_active AND correct_index IS NOT NULL ORDER BY id LIMIT 1;
  IF a IS NULL OR b IS NULL OR q IS NULL OR hidden IS NULL THEN
    INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
      ('fixture: an exam account, its question, a second account, a school question','-','all four','not found','FAIL');
    RETURN;
  END IF;

  -- 1.
  r := pg_temp.as_user(a, format($q$SELECT (public.rpc_report_question(%L, 'question_error', NULL, 'probe48 note'))->'report'->>'status'$q$, q));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('files a report on a question they can be served (positive control)','student (owner)','OK: open', r, CASE WHEN r = 'OK: open' THEN 'PASS' ELSE 'FAIL' END);
  -- 2.
  r := pg_temp.as_user(a, $q$SELECT count(*)::text FROM public.question_reports WHERE note = 'probe48 note'$q$);
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('reads their own report (positive control)','student (owner)','OK: 1', r, CASE WHEN r = 'OK: 1' THEN 'PASS' ELSE 'FAIL' END);
  -- 3.
  r := pg_temp.as_user(b, $q$SELECT count(*)::text FROM public.question_reports WHERE note = 'probe48 note'$q$);
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('reads another student''s report','another student','OK: 0', r, CASE WHEN r = 'OK: 0' THEN 'PASS' ELSE 'FAIL' END);
  -- 4.
  r := pg_temp.as_user(a, format($q$INSERT INTO public.question_reports (user_id, question_id, reason, question_text, options) VALUES (%L, %L, 'other', 'forged', '[]') RETURNING 'written'$q$, a, hidden));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('writes a report row directly','student (owner)','ERROR: permission denied', r,
     CASE WHEN r LIKE 'ERROR:%permission denied%' THEN 'PASS' ELSE 'FAIL' END);
  r := pg_temp.as_user(a, $q$UPDATE public.question_reports SET status = 'fixed' WHERE note = 'probe48 note' RETURNING 'changed'$q$);
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('settles their own report by hand','student (owner)','ERROR: permission denied', r,
     CASE WHEN r LIKE 'ERROR:%permission denied%' THEN 'PASS' ELSE 'FAIL' END);
  -- 5.
  r := pg_temp.as_anon($q$SELECT count(*)::text FROM public.question_reports$q$);
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('reads reports signed out','anon','ERROR: permission denied', r,
     CASE WHEN r LIKE 'ERROR:%permission denied%' THEN 'PASS' ELSE 'FAIL' END);
  r := pg_temp.as_anon(format($q$SELECT public.rpc_report_question(%L, 'other', NULL, 'x')::text$q$, q));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('files a report signed out','anon','ERROR: permission denied', r,
     CASE WHEN r LIKE 'ERROR:%permission denied for function rpc_report_question%' THEN 'PASS' ELSE 'FAIL' END);
  -- 6.
  r := pg_temp.as_user(a, $q$SELECT count(*)::text FROM public.claim_question_reports(1)$q$);
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('claims reports for the check','student','ERROR: permission denied', r,
     CASE WHEN r LIKE 'ERROR:%permission denied for function claim_question_reports%' THEN 'PASS' ELSE 'FAIL' END);
  r := pg_temp.as_user(a, format($q$SELECT public.apply_question_report_verdict(%L, '{"kind":"withdraw","outcome":"x","reports":[]}')::text$q$, q));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('applies a verdict to a question','student','ERROR: permission denied', r,
     CASE WHEN r LIKE 'ERROR:%permission denied for function apply_question_report_verdict%' THEN 'PASS' ELSE 'FAIL' END);
  r := pg_temp.as_user(a, format($q$SELECT public._retire_reported_question(%L, NULL, false, 'x')::text$q$, q));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('retires a question','student','ERROR: permission denied', r,
     CASE WHEN r LIKE 'ERROR:%permission denied for function _retire_reported_question%' THEN 'PASS' ELSE 'FAIL' END);
  -- 7.
  r := pg_temp.as_user(a, format($q$SELECT public.rpc_report_question(%L, 'question_error')::text$q$, hidden));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('reports a question they cannot be served','student','ERROR: That question could not be found.', r,
     CASE WHEN r = 'ERROR: That question could not be found.' THEN 'PASS' ELSE 'FAIL' END);
END $probe$;

SELECT area, role_tested, expected, observed, verdict FROM probe ORDER BY n;
ROLLBACK;
