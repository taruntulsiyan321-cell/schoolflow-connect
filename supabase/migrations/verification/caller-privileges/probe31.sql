-- probe31: a test question's format, as the caller.
--
-- 20260914040000 gave `test_questions` a `question_format` and an `answer`, so
-- `correct` can never mean "the correct option" in one row and "a paragraph a
-- person marks" in another (G9). 20260914050000 then corrected where the line
-- falls: §10.24's rule is AUTO-MARKABLE versus HAND-MARKED, not MCQ versus
-- rest. `numerical` is graded by the same jsonb equality as an MCQ and stays
-- online; only `short` and `long` are prose a person has to read.
--
-- THE CLAIMS
--   1. the student session is genuinely authenticated.        (harness control)
--   2. an ordinary MCQ test still serves its questions.       <- POSITIVE CONTROL
--      This is the one this migration could most easily have broken, and a
--      suite that only tested the refusal would not have noticed.
--   3. the answer key is still absent from what a student receives.
--   4. a paper containing a WRITTEN question refuses, naming §10.24.
--   4b. ...while a NUMERICAL question is served like any other.
--   5. ...and refuses rather than serving a SHORTER paper.  <- no silent truncation
--   6. a written question may not hide its answer in `correct`.
--   7. an MCQ may not carry an `answer`.
--   8. another student cannot read this attempt at all.      (untouched fence)
--
-- Every write is rolled back.
BEGIN;
SET LOCAL statement_timeout = '30s';
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
  stu     uuid := 'd1000003-0001-4000-8000-000000000001';  -- Arjun Mehta
  other   uuid;
  sch_a   uuid := '00000000-0000-4000-8000-000000000001';
  cls_a   uuid := 'd2000001-0001-4000-8000-000000000001';
  ss_a    uuid;
  t_id    uuid;
  att     uuid;
  r       text;
BEGIN
  SELECT s.user_id INTO other FROM public.students s
   WHERE s.class_id = cls_a AND s.user_id IS NOT NULL AND s.user_id <> stu
   ORDER BY s.user_id LIMIT 1;
  IF other IS NULL THEN RAISE EXCEPTION 'probe31: need a second 10-A student'; END IF;

  -- `tests` anchors on section_subject (§10.22), not on a class — there is
  -- deliberately no second class_id column naming the same fact (G9).
  -- `section_subjects.section_id` points at `classes` — a "section" IS a class
  -- row here (name + section). There is no `public.sections` table; probe7
  -- resolves it the same way.
  SELECT ss.id INTO ss_a FROM public.section_subjects ss
    JOIN public.classes c ON c.id = ss.section_id
   WHERE c.id = cls_a ORDER BY ss.id LIMIT 1;
  IF ss_a IS NULL THEN
    SELECT ss.id INTO ss_a FROM public.section_subjects ss
      JOIN public.classes c ON c.id = ss.section_id
     WHERE c.school_id = sch_a ORDER BY ss.id LIMIT 1;
  END IF;
  IF ss_a IS NULL THEN RAISE EXCEPTION 'probe31: school A has no section_subject'; END IF;

  INSERT INTO public.tests (school_id, section_subject_id, max_mark, title, created_by)
  VALUES (sch_a, ss_a, 10, 'probe31 paper', stu)
  RETURNING id INTO t_id;

  INSERT INTO public.test_questions
    (test_id, school_id, order_index, question, options, correct, marks)
  VALUES
    (t_id, sch_a, 1, 'probe31 mcq', '["a","b","c","d"]'::jsonb, '{"indexes":[0]}'::jsonb, 1),
    (t_id, sch_a, 2, 'probe31 mcq two', '["a","b","c","d"]'::jsonb, '{"indexes":[1]}'::jsonb, 1);

  INSERT INTO public.test_attempts (test_id, user_id, school_id)
  VALUES (t_id, stu, sch_a) RETURNING id INTO att;

  -- ── 1. the session is real ──────────────────────────────────────────────
  r := pg_temp.as_user(stu, 'SELECT public.get_my_role()::text');
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('the probe session is genuinely authenticated (control)','student','OK: student', r,
     CASE WHEN r = 'OK: student' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 2. an ordinary MCQ paper still works ───────────────────────────────
  r := pg_temp.as_user(stu, format(
        'SELECT count(*)::text FROM public.rpc_test_questions_for_attempt(%L::uuid)', att));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('an all-MCQ paper still serves (POSITIVE CONTROL)','student (owns the attempt)','OK: 2', r,
     CASE WHEN r = 'OK: 2' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 3. and still without the key ───────────────────────────────────────
  INSERT INTO probe(area,role_tested,expected,observed,verdict)
  SELECT 'the answer key is not in what a student receives','-','absent',
         CASE WHEN d ~ 'q\.correct' OR d ~ 'q\.answer' THEN 'present' ELSE 'absent' END,
         CASE WHEN d ~ 'q\.correct' OR d ~ 'q\.answer' THEN 'FAIL' ELSE 'PASS' END
    FROM (SELECT pg_get_functiondef(p.oid) AS d FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
           WHERE n.nspname='public' AND p.proname='rpc_test_questions_for_attempt') t;

  -- ── 8. someone else's attempt ──────────────────────────────────────────
  r := pg_temp.as_user(other, format(
        'SELECT count(*)::text FROM public.rpc_test_questions_for_attempt(%L::uuid)', att));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('read another student''s attempt','student (not the owner)','ERROR Not your attempt', r,
     CASE WHEN r LIKE 'ERROR%Not your attempt%' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 6/7. the shape constraint, both directions ─────────────────────────
  BEGIN
    INSERT INTO public.test_questions
      (test_id, school_id, order_index, question, question_format, correct, marks)
    VALUES (t_id, sch_a, 6, 'probe31 written in correct', 'short', '"a paragraph"'::jsonb, 5);
    r := 'OK: accepted';
  EXCEPTION WHEN check_violation THEN r := 'ERROR: check_violation';
  END;
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('hide a written answer in `correct` (route (c))','-','ERROR: check_violation', r,
     CASE WHEN r = 'ERROR: check_violation' THEN 'PASS' ELSE 'FAIL' END);

  BEGIN
    INSERT INTO public.test_questions
      (test_id, school_id, order_index, question, options, correct, answer, marks)
    VALUES (t_id, sch_a, 4, 'probe31 mcq with an answer too', '["a","b"]'::jsonb, '{"indexes":[0]}'::jsonb, 'also this', 1);
    r := 'OK: accepted';
  EXCEPTION WHEN check_violation THEN r := 'ERROR: check_violation';
  END;
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('an MCQ carrying a written answer as well','-','ERROR: check_violation', r,
     CASE WHEN r = 'ERROR: check_violation' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 4b. numerical is auto-marked, so it stays online ───────────────────
  -- Without this the suite would pass on a rule that quietly excluded a format
  -- the grader handles perfectly well.
  INSERT INTO public.test_questions
    (test_id, school_id, order_index, question, question_format, correct, marks)
  VALUES (t_id, sch_a, 3, 'probe31 what is 2+2', 'numerical', '{"value": 4}'::jsonb, 1);

  r := pg_temp.as_user(stu, format(
        'SELECT count(*)::text FROM public.rpc_test_questions_for_attempt(%L::uuid)', att));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('a NUMERICAL question is still served (positive control)','student (owns the attempt)','OK: 3', r,
     CASE WHEN r = 'OK: 3' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 4/5. a mixed paper refuses, and does not quietly shrink ────────────
  INSERT INTO public.test_questions
    (test_id, school_id, order_index, question, question_format, answer, marks)
  VALUES (t_id, sch_a, 5, 'probe31 explain photosynthesis', 'long', 'A model answer.', 5);

  r := pg_temp.as_user(stu, format(
        'SELECT count(*)::text FROM public.rpc_test_questions_for_attempt(%L::uuid)', att));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('attempt a paper containing a written question','student (owns the attempt)',
     'ERROR naming §10.24', r,
     CASE WHEN r LIKE 'ERROR%10.24%' THEN 'PASS' ELSE 'FAIL' END);

  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('...and did NOT quietly serve a shorter paper instead','student (owns the attempt)',
     'not OK: 3', r,
     CASE WHEN r LIKE 'OK:%' THEN 'FAIL' ELSE 'PASS' END);
END $probe$;

SELECT area, role_tested, expected, observed, verdict FROM probe ORDER BY n;
ROLLBACK;
