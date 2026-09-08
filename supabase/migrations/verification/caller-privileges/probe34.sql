-- probe34: a student takes a test end to end, AS THE STUDENT (§7, §10.8, §10.22).
--
-- REPLACES supabase/migrations/verification/CHUNK75_VERIFY.sql, which is
-- deleted. That file made the right claims and could not support them.
--
-- WHY IT WAS REPLACED RATHER THAN EDITED
--
-- CHUNK75_VERIFY set `request.jwt.claims` and never set `role`, so items 1-4 —
-- rpc_test_start, rpc_test_questions_for_attempt, rpc_test_submit, test_marks,
-- student_mistakes, test_answers — all ran as the TABLE OWNER. The file says so
-- itself: "SET LOCAL ROLE matters here and nowhere else in this file."
--
-- Its defence was that the RPCs are SECURITY DEFINER and take the caller from
-- the JWT, which is true of `auth.uid()` and beside the point. Running as the
-- owner cannot see:
--
--   - a MISSING EXECUTE GRANT. Exactly what happened on 2026-09-08:
--     20260914060000 had to DROP rpc_test_questions_for_attempt to widen its
--     RETURNS TABLE, the DROP took the grants with it, and every student got
--     `permission denied for function`. As the owner, that is invisible.
--   - RLS on any table the RPCs touch, which does not apply to the owner.
--
-- So `definer-inventory.json` cited "drives it as a real student, end to end"
-- for a file that drove it as postgres. Those three citations now point here.
--
-- A SECOND REASON, AND THE ONE THAT PROMPTED THIS
--
-- CHUNK75_VERIFY keyed its own questions by the option TEXT and answered them
-- by the option TEXT, so it agreed with itself and with nothing else. The real
-- client keys by POSITION (`QuestionRenderer` sends `{"indexes":[i]}`). Its
-- end-to-end "PASS" therefore coexisted with 576 questions in this project that
-- no student could ever have been marked right on -- see 20260914080000.
-- Everything below uses the shape the browser actually sends.
--
-- THE CLAIMS (CHUNK75's seven, kept, and now as the caller)
--   1.  the student session is genuinely authenticated.      (harness control)
--   2.  rpc_test_start is callable BY A STUDENT.        <- grant + RLS covered
--   3.  rpc_test_questions_for_attempt serves the paper to that student.
--   4.  ...and still omits the answer key.                             (G14)
--   5.  rpc_test_submit marks it: Q1 right, Q2 wrong, Q3 skipped -> 1 of 3.
--   6.  the mark lands in test_marks, one per student per test.     (§10.22)
--   7.  both the wrong AND the skipped question reach the mistake book,
--       chapter-keyed.
--   8.  per-question answers do not survive the session.             (§10.8)
--   9.  the student cannot SELECT test_questions directly.
--   10. `dpp` is gone from every schema surface.
--   11. `tests` is anchored on section_subject_id, never class_id.
--
-- The paper is deliberately answered PARTLY wrong: a fully-correct run passes
-- claims 6 and 7 vacuously, and claim 5 would pass against a grader that marked
-- everything right.
--
-- Claims 6-8 are read as the owner ON PURPOSE — they are about what the
-- database durably stored, not about what the student may see. Claim 9 is the
-- one that is about the student's reach, and it runs as the student.
--
-- Every write is rolled back.
BEGIN;
SET LOCAL statement_timeout = '60s';
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

DO $probe$
DECLARE
  demo    uuid := '00000000-0000-4000-8000-000000000001';
  stu     uuid;
  sid     uuid;
  teacher uuid;
  ss      uuid;
  ay      uuid;
  chap    uuid;
  t_id    uuid;
  q       uuid[];
  att     uuid;
  r       text;
  j       jsonb;
  n       int;
  m       int;
BEGIN
  SELECT s.user_id, s.id INTO stu, sid
    FROM public.students s
   WHERE s.school_id = demo AND s.user_id IS NOT NULL AND s.deleted_at IS NULL
   ORDER BY s.id LIMIT 1;
  SELECT id INTO teacher FROM auth.users WHERE email = 'priya.sharma@wisdomcampus.com';
  SELECT ss2.id INTO ss FROM public.section_subjects ss2 WHERE ss2.school_id = demo ORDER BY ss2.id LIMIT 1;
  SELECT ay2.id INTO ay FROM public.academic_years ay2 WHERE ay2.school_id = demo ORDER BY ay2.id LIMIT 1;
  SELECT c.id INTO chap FROM public.chapters c ORDER BY c.id LIMIT 1;

  -- A skipped check is not a passing check.
  IF stu IS NULL OR teacher IS NULL OR ss IS NULL OR ay IS NULL OR chap IS NULL THEN
    RAISE EXCEPTION 'probe34: demo fixtures missing (student=%, teacher=%, ss=%, ay=%, chapter=%)',
      stu, teacher, ss, ay, chap;
  END IF;

  -- The TEACHER authors the paper. Using the student's own uid for created_by
  -- would make them the author, which legitimately passes test_questions_write
  -- (FOR ALL, so it covers SELECT) and would make claim 9 fail for a reason
  -- that cannot happen in the app. This is CHUNK75's finding, kept.
  INSERT INTO public.tests (school_id, academic_year_id, section_subject_id, created_by,
                            topic, date, max_mark, status, published_at, duration_sec)
  VALUES (demo, ay, ss, teacher, 'probe34 paper', CURRENT_DATE, 3, 'published', now(), 600)
  RETURNING id INTO t_id;

  -- Keys are POSITIONS, which is what QuestionRenderer sends and what
  -- test_questions_shape_matches_format has required since 20260914080000.
  INSERT INTO public.test_questions
    (test_id, school_id, order_index, question, question_format, options, correct,
     marks, explanation, chapter_id, chapter)
  VALUES
    (t_id, demo, 1, 'probe34 Q1', 'mcq', '["a","b"]'::jsonb, '{"indexes":[0]}'::jsonb, 1, 'because a', chap, 'Ch1'),
    (t_id, demo, 2, 'probe34 Q2', 'mcq', '["a","b"]'::jsonb, '{"indexes":[1]}'::jsonb, 1, 'because b', chap, 'Ch1'),
    (t_id, demo, 3, 'probe34 Q3', 'mcq', '["a","b"]'::jsonb, '{"indexes":[0]}'::jsonb, 1, 'because a', chap, 'Ch1');

  SELECT array_agg(id ORDER BY order_index) INTO q
    FROM public.test_questions WHERE test_id = t_id;

  -- ── 1. the session is real ──────────────────────────────────────────────
  r := pg_temp.as_user(stu, 'SELECT public.get_my_role()::text');
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('the probe session is genuinely authenticated (control)','student','OK: student', r,
     CASE WHEN r = 'OK: student' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 2. rpc_test_start, as the student ───────────────────────────────────
  -- CHUNK75 called this as the owner, so a revoked EXECUTE would have passed.
  r := pg_temp.as_user(stu, format('SELECT public.rpc_test_start(%L::uuid)::text', t_id));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('rpc_test_start is callable BY A STUDENT','student','OK: <attempt uuid>',
     left(r, 46),
     CASE WHEN r LIKE 'OK: %' AND r NOT LIKE 'OK: null' THEN 'PASS' ELSE 'FAIL' END);
  IF r LIKE 'OK: %' AND r NOT LIKE 'OK: null' THEN
    att := replace(r, 'OK: ', '')::uuid;
  ELSE
    RAISE EXCEPTION 'probe34: rpc_test_start failed as the student (%) -- nothing below could mean anything', r;
  END IF;

  -- ── 3. the paper is served to that student ──────────────────────────────
  r := pg_temp.as_user(stu, format(
        'SELECT count(*)::text FROM public.rpc_test_questions_for_attempt(%L::uuid)', att));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('rpc_test_questions_for_attempt serves the paper','student (owns the attempt)','OK: 3', r,
     CASE WHEN r = 'OK: 3' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 4. and still without the key ────────────────────────────────────────
  INSERT INTO probe(area,role_tested,expected,observed,verdict)
  SELECT 'the served paper omits the answer key','-','absent',
         CASE WHEN d ~ 'q\.correct' OR d ~ 'q\.answer' THEN 'present' ELSE 'absent' END,
         CASE WHEN d ~ 'q\.correct' OR d ~ 'q\.answer' THEN 'FAIL' ELSE 'PASS' END
    FROM (SELECT pg_get_functiondef(p.oid) AS d FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
           WHERE n.nspname='public' AND p.proname='rpc_test_questions_for_attempt') t;

  -- ── 5. marking: Q1 right, Q2 wrong, Q3 never answered ───────────────────
  r := pg_temp.as_user(stu, format(
        'SELECT public.rpc_test_submit(%L::uuid, %L::jsonb)::text', att,
        json_build_array(
          json_build_object('question_id', q[1], 'response', json_build_object('indexes', json_build_array(0))),
          json_build_object('question_id', q[2], 'response', json_build_object('indexes', json_build_array(0)))
        )::text));
  BEGIN
    j := (regexp_replace(r, '^OK: ', ''))::jsonb;
  EXCEPTION WHEN OTHERS THEN j := '{}'::jsonb;
  END;
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('rpc_test_submit marks a partly-wrong paper','student (owns the attempt)','OK: score 1 of 3',
     format('score %s, correct %s of %s', coalesce(j->>'score','?'),
            coalesce(j->>'correct_count','?'), coalesce(j->>'total_count','?')),
     CASE WHEN (j->>'score') = '1' AND (j->>'correct_count') = '1' AND (j->>'total_count') = '3'
          THEN 'PASS' ELSE 'FAIL' END);

  -- ── 6. the mark is the durable outcome (§10.22) ─────────────────────────
  SELECT count(*)::int INTO n FROM public.test_marks WHERE test_id = t_id AND student_id = sid;
  SELECT count(*)::int INTO m FROM public.test_marks WHERE test_id = t_id AND student_id = sid AND mark = 1;
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('test_marks holds exactly one row, and it is 1','- (durable state, read as owner)','1 row, mark 1',
     format('%s row(s), %s with mark 1', n, m),
     CASE WHEN n = 1 AND m = 1 THEN 'PASS' ELSE 'FAIL' END);

  -- ── 7. the mistake book gets the wrong one AND the skipped one ──────────
  SELECT count(*)::int, count(*) FILTER (WHERE chapter_id IS NOT NULL)::int
    INTO n, m
    FROM public.student_mistakes WHERE user_id = stu AND source_id = t_id;
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('wrong AND skipped both reach the mistake book, chapter-keyed','- (durable state, read as owner)','2 of 2',
     format('%s mistake(s), %s chapter-keyed', n, m),
     CASE WHEN n = 2 AND m = 2 THEN 'PASS' ELSE 'FAIL' END);

  -- ── 8. working state is purged (§10.8) ──────────────────────────────────
  SELECT count(*)::int INTO n FROM public.test_answers WHERE attempt_id = att;
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('per-question answers do not survive the session','- (durable state, read as owner)','0', n::text,
     CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END);

  -- ── 9. the student cannot reach the key directly ────────────────────────
  -- 7.5a granted SELECT on test_questions to anyone in the institution, and
  -- that includes `correct`. 7.5b narrowed it to staff; this is the outcome.
  r := pg_temp.as_user(stu, format(
        'SELECT count(*)::text FROM public.test_questions WHERE test_id = %L::uuid', t_id));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('direct SELECT on test_questions (the key lives there)','student','OK: 0', r,
     CASE WHEN r = 'OK: 0' THEN 'PASS' ELSE 'FAIL' END);

  -- Positive control for claim 9: staff must still be able to read it, or a
  -- policy that simply hid the table from everyone would pass.
  r := pg_temp.as_user(teacher, format(
        'SELECT count(*)::text FROM public.test_questions WHERE test_id = %L::uuid', t_id));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('...while the authoring teacher still reads it (positive control)','teacher','OK: 3', r,
     CASE WHEN r = 'OK: 3' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 10. dpp is gone from every schema surface ───────────────────────────
  SELECT (SELECT count(*) FROM pg_class c JOIN pg_namespace ns ON ns.oid=c.relnamespace
           WHERE ns.nspname='public' AND c.relname ILIKE '%dpp%')
       + (SELECT count(*) FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
           WHERE ns.nspname='public' AND p.prokind='f' AND pg_get_functiondef(p.oid) ~* 'dpp')
       + (SELECT count(*) FROM information_schema.columns
           WHERE table_schema='public' AND column_name ILIKE '%dpp%')
       + (SELECT count(*) FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid
            JOIN pg_namespace ns ON ns.oid=t.relnamespace
           WHERE ns.nspname='public' AND pg_get_constraintdef(c.oid) ILIKE '%dpp%')
       + (SELECT count(*) FROM pg_type t JOIN pg_namespace ns ON ns.oid=t.typnamespace
           WHERE ns.nspname='public' AND t.typname ILIKE '%dpp%')
       + (SELECT count(*) FROM public.student_badges WHERE badge_code ILIKE '%dpp%')
    INTO n;
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('dpp references across tables/functions/columns/constraints/types/badges','-','0', n::text,
     CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END);

  -- ── 11. a test is anchored on the section subject, never a class ────────
  INSERT INTO probe(area,role_tested,expected,observed,verdict)
  SELECT 'tests anchor','-','section_subject only', v,
         CASE WHEN v = 'section_subject only' THEN 'PASS' ELSE 'FAIL' END
    FROM (SELECT CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
                                    WHERE table_schema='public' AND table_name='tests'
                                      AND column_name='section_subject_id')
                       AND NOT EXISTS (SELECT 1 FROM information_schema.columns
                                        WHERE table_schema='public' AND table_name='tests'
                                          AND column_name='class_id')
                      THEN 'section_subject only' ELSE 'class_id present' END AS v) s;
END $probe$;

SELECT area, role_tested, expected, observed, verdict FROM probe ORDER BY n;
ROLLBACK;
