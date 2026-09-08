-- probe32: a manually built test can be saved AND sat (KNOWN_ISSUES 28).
--
-- The Tests feature was broken at both ends and neither end could reveal the
-- other:
--
--   TEACHER  `TestService.setQuestions` sent a `kind` column that
--            `test_questions` does not have, behind an `insert(rows as never)`
--            cast. PostgREST rejects an unknown column with PGRST204, so no
--            manually built test ever saved a question.
--   STUDENT  `rpc_test_questions_for_attempt` returned no format, and
--            `QuestionRenderer` branches entirely on it — so every question
--            would have rendered as a stem with no way to answer it.
--
-- Nothing could be saved, so nothing could be rendered, so nobody noticed.
--
-- THE CLAIMS
--   1. the student session is genuinely authenticated.        (harness control)
--   2. an `insert` carrying `kind` is still rejected.   <- the original defect,
--      pinned so nobody reintroduces the column name.
--   3. the shape the service now writes is ACCEPTED.          (positive control)
--   4. the student receives `question_format` for every question.  <- the fix
--   5. ...and still does NOT receive `correct` or `answer`.        (G14)
--   6. a written question stores its model answer in `answer`, not `correct`.
--   7. submitting grades against `correct` and returns the format for review.
--   8. another student still cannot read the attempt.        (untouched fence)
--
-- Claim 3 is what makes 2 meaningful: "the insert fails" is only evidence if
-- the corrected insert succeeds.
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
  stu   uuid := 'd1000003-0001-4000-8000-000000000001';
  other uuid;
  sch_a uuid := '00000000-0000-4000-8000-000000000001';
  cls_a uuid := 'd2000001-0001-4000-8000-000000000001';
  ss_a  uuid;
  t_id  uuid;
  att   uuid;
  q_mcq uuid;
  r     text;
  j     jsonb;
BEGIN
  SELECT s.user_id INTO other FROM public.students s
   WHERE s.class_id = cls_a AND s.user_id IS NOT NULL AND s.user_id <> stu
   ORDER BY s.user_id LIMIT 1;
  SELECT ss.id INTO ss_a FROM public.section_subjects ss
    JOIN public.classes c ON c.id = ss.section_id
   WHERE c.id = cls_a ORDER BY ss.id LIMIT 1;
  IF ss_a IS NULL THEN
    SELECT ss.id INTO ss_a FROM public.section_subjects ss
      JOIN public.classes c ON c.id = ss.section_id
     WHERE c.school_id = sch_a ORDER BY ss.id LIMIT 1;
  END IF;
  IF other IS NULL OR ss_a IS NULL THEN
    RAISE EXCEPTION 'probe32: need a second 10-A student and a section_subject';
  END IF;

  INSERT INTO public.tests (school_id, section_subject_id, max_mark, title, created_by)
  VALUES (sch_a, ss_a, 10, 'probe32 paper', stu) RETURNING id INTO t_id;

  -- ── 1. the session is real ──────────────────────────────────────────────
  r := pg_temp.as_user(stu, 'SELECT public.get_my_role()::text');
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('the probe session is genuinely authenticated (control)','student','OK: student', r,
     CASE WHEN r = 'OK: student' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 2. `kind` is still not a column ────────────────────────────────────
  BEGIN
    EXECUTE format(
      'INSERT INTO public.test_questions (test_id, school_id, order_index, question, kind, options, correct, marks) '
      'VALUES (%L::uuid, %L::uuid, 90, ''probe32 kind column'', ''mcq'', ''["a","b"]''::jsonb, ''{"indexes":[0]}''::jsonb, 1)',
      t_id, sch_a);
    r := 'OK: accepted';
  EXCEPTION WHEN undefined_column THEN r := 'ERROR: undefined_column';
  END;
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('write a `kind` column (the original PGRST204)','-','ERROR: undefined_column', r,
     CASE WHEN r = 'ERROR: undefined_column' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 3. the shape the service writes now ────────────────────────────────
  BEGIN
    INSERT INTO public.test_questions
      (test_id, school_id, order_index, question, question_format, options, correct, answer, marks)
    VALUES (t_id, sch_a, 1, 'probe32 which is 2+2', 'mcq',
            '["3","4","5","6"]'::jsonb, '{"indexes":[1]}'::jsonb, NULL, 2)
    RETURNING id INTO q_mcq;
    r := 'OK: accepted';
  EXCEPTION WHEN OTHERS THEN r := 'ERROR: ' || SQLERRM;
  END;
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('write the shape setQuestions now sends (POSITIVE CONTROL)','-','OK: accepted', r,
     CASE WHEN r = 'OK: accepted' THEN 'PASS' ELSE 'FAIL' END);

  INSERT INTO public.test_questions
    (test_id, school_id, order_index, question, question_format, options, correct, marks)
  VALUES (t_id, sch_a, 2, 'probe32 how many sides', 'numerical',
          '[]'::jsonb, '{"value":4}'::jsonb, 3);

  -- ── 6. a written question keeps its answer out of `correct` ────────────
  BEGIN
    INSERT INTO public.test_questions
      (test_id, school_id, order_index, question, question_format, answer, correct, marks)
    VALUES (t_id, sch_a, 91, 'probe32 explain', 'long', 'A model answer.', '{"text":"also here"}'::jsonb, 5);
    r := 'OK: accepted';
  EXCEPTION WHEN check_violation THEN r := 'ERROR: check_violation';
  END;
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('a written question ALSO filling `correct`','-','ERROR: check_violation', r,
     CASE WHEN r = 'ERROR: check_violation' THEN 'PASS' ELSE 'FAIL' END);

  INSERT INTO public.test_attempts (test_id, user_id, school_id)
  VALUES (t_id, stu, sch_a) RETURNING id INTO att;

  -- ── 4. the student gets the format ─────────────────────────────────────
  r := pg_temp.as_user(stu, format(
        'SELECT count(*)::text FROM public.rpc_test_questions_for_attempt(%L::uuid) '
        'WHERE question_format IS NOT NULL', att));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('every served question carries its format','student (owns the attempt)','OK: 2', r,
     CASE WHEN r = 'OK: 2' THEN 'PASS' ELSE 'FAIL' END);

  r := pg_temp.as_user(stu, format(
        'SELECT string_agg(question_format, '','' ORDER BY order_index) '
        'FROM public.rpc_test_questions_for_attempt(%L::uuid)', att));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('...and it is the format that was written','student (owns the attempt)','OK: mcq,numerical', r,
     CASE WHEN r = 'OK: mcq,numerical' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 5. the key is still withheld ───────────────────────────────────────
  INSERT INTO probe(area,role_tested,expected,observed,verdict)
  SELECT 'the attempt path still withholds the answer key','-','absent',
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

  -- ── 7. submit: it grades, and the review payload can be drawn ──────────
  r := pg_temp.as_user(stu, format(
        'SELECT public.rpc_test_submit(%L::uuid, %L::jsonb)::text', att,
        json_build_array(json_build_object(
          'question_id', q_mcq, 'response', json_build_object('indexes', json_build_array(1))
        ))::text));
  BEGIN
    j := (regexp_replace(r, '^OK: ', ''))::jsonb;
  EXCEPTION WHEN OTHERS THEN j := '{}'::jsonb;
  END;

  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('the right answer scores its marks','student (owns the attempt)','OK: score 2',
     'score ' || coalesce(j->>'score','?'),
     CASE WHEN (j->>'score') = '2' THEN 'PASS' ELSE 'FAIL' END);

  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('the review payload carries the format too','student (owns the attempt)','OK: mcq',
     coalesce(j#>>'{questions,0,question_format}', 'absent'),
     CASE WHEN (j#>>'{questions,0,question_format}') = 'mcq' THEN 'PASS' ELSE 'FAIL' END);
END $probe$;

SELECT area, role_tested, expected, observed, verdict FROM probe ORDER BY n;
ROLLBACK;
