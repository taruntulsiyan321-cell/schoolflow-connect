-- probe33: an answer key is a POSITION, and a student who picks the right
-- option is marked right (KNOWN_ISSUES 28, second half; §7, §10.24).
--
-- `rpc_test_submit` marks with `a.response = q.correct` — plain jsonb equality
-- — and `QuestionRenderer` sends `{"indexes":[i]}`. Every one of the 576 rows
-- in this project held the option's TEXT instead, so the equality could never
-- hold and the student scored zero whatever they picked. 20260914080000
-- rewrote the keys and tightened `test_questions_shape_matches_format`, which
-- until then asserted only `correct IS NOT NULL` for a choice question.
--
-- THE CLAIMS
--   1. the student session is genuinely authenticated.        (harness control)
--   2. a label key is REFUSED.                        <- the constraint's point
--   3. a position key is ACCEPTED.                            (positive control)
--   4. a key that addresses no option is REFUSED — an index past the end, an
--      empty array, a numerical key holding a string — with the last VALID
--      index and a real numeric key as the positive controls.
--   5. a student picking the right option SCORES.       <- what the fix is for
--   6. a student picking a wrong option scores zero.          (negative control)
--   7. no row anywhere in the table still keys on the option text.
--   8. the key is still withheld from the attempt path.       (untouched fence)
--
-- Claim 3 is what makes claim 2 mean anything: "the insert fails" is evidence
-- only if the corrected insert succeeds. Claim 6 is what makes claim 5 mean
-- anything: a grader that marked everything correct would pass claim 5 alone.
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
  sch_a uuid := '00000000-0000-4000-8000-000000000001';
  cls_a uuid := 'd2000001-0001-4000-8000-000000000001';
  ss_a  uuid;
  t_id  uuid;
  att   uuid;
  q_bad uuid;
  q_ok  uuid;
  r     text;
  j     jsonb;
  n     int;
BEGIN
  SELECT ss.id INTO ss_a FROM public.section_subjects ss
    JOIN public.classes c ON c.id = ss.section_id
   WHERE c.id = cls_a ORDER BY ss.id LIMIT 1;
  IF ss_a IS NULL THEN
    SELECT ss.id INTO ss_a FROM public.section_subjects ss
      JOIN public.classes c ON c.id = ss.section_id
     WHERE c.school_id = sch_a ORDER BY ss.id LIMIT 1;
  END IF;
  IF ss_a IS NULL THEN
    RAISE EXCEPTION 'probe33: need a section_subject in school A';
  END IF;

  INSERT INTO public.tests (school_id, section_subject_id, max_mark, title, created_by)
  VALUES (sch_a, ss_a, 10, 'probe33 paper', stu) RETURNING id INTO t_id;

  -- ── 1. the session is real ──────────────────────────────────────────────
  r := pg_temp.as_user(stu, 'SELECT public.get_my_role()::text');
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('the probe session is genuinely authenticated (control)','student','OK: student', r,
     CASE WHEN r = 'OK: student' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 2. the shape the fixtures used is refused now ───────────────────────
  BEGIN
    INSERT INTO public.test_questions
      (test_id, school_id, order_index, question, question_format, options, correct, marks)
    VALUES (t_id, sch_a, 80, 'probe33 label key', 'mcq',
            '["a","b","c","d"]'::jsonb, '"a"'::jsonb, 1);
    r := 'OK: accepted';
  EXCEPTION WHEN check_violation THEN r := 'ERROR: check_violation';
  END;
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('key a choice question by the option TEXT','-','ERROR: check_violation', r,
     CASE WHEN r = 'ERROR: check_violation' THEN 'PASS' ELSE 'FAIL' END);

  -- An object that is not a key is refused for the same reason.
  BEGIN
    INSERT INTO public.test_questions
      (test_id, school_id, order_index, question, question_format, options, correct, marks)
    VALUES (t_id, sch_a, 81, 'probe33 wrong key name', 'mcq',
            '["a","b"]'::jsonb, '{"value":0}'::jsonb, 1);
    r := 'OK: accepted';
  EXCEPTION WHEN check_violation THEN r := 'ERROR: check_violation';
  END;
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('key a choice question with {"value":...}','-','ERROR: check_violation', r,
     CASE WHEN r = 'ERROR: check_violation' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 3. the shape the client writes is accepted (POSITIVE CONTROL) ──────
  BEGIN
    INSERT INTO public.test_questions
      (test_id, school_id, order_index, question, question_format, options, correct, marks)
    VALUES (t_id, sch_a, 1, 'probe33 which letter is second', 'mcq',
            '["a","b","c","d"]'::jsonb, '{"indexes":[1]}'::jsonb, 2)
    RETURNING id INTO q_ok;
    r := 'OK: accepted';
  EXCEPTION WHEN check_violation THEN r := 'ERROR: check_violation';
  END;
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('key a choice question by POSITION (positive control)','-','OK: accepted', r,
     CASE WHEN r = 'OK: accepted' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 4. a key that addresses no option is refused ──────────────────────
  -- This was an accepted GAP until 20260914110000: a CHECK may not run a
  -- subquery, so `test_questions_shape_matches_format` pins the SHAPE of the key
  -- and cannot compare its indexes against the LENGTH of `options`.
  -- `{"indexes":[7]}` on a two-option question is exactly as unmarkable as the
  -- label shape was. A trigger closes it, for the same reason
  -- tg_question_bank_class_follows_chapter is a trigger.
  BEGIN
    INSERT INTO public.test_questions
      (test_id, school_id, order_index, question, question_format, options, correct, marks)
    VALUES (t_id, sch_a, 82, 'probe33 index past the end', 'mcq',
            '["a","b"]'::jsonb, '{"indexes":[7]}'::jsonb, 1);
    r := 'OK: accepted';
  EXCEPTION WHEN check_violation THEN r := 'ERROR: check_violation';
  END;
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('an index past the end of `options`','-','ERROR: check_violation', r,
     CASE WHEN r = 'ERROR: check_violation' THEN 'PASS' ELSE 'FAIL' END);
  DELETE FROM public.test_questions WHERE test_id = t_id AND order_index = 82;

  -- An empty key: nothing is correct, so nothing can be marked correct.
  BEGIN
    INSERT INTO public.test_questions
      (test_id, school_id, order_index, question, question_format, options, correct, marks)
    VALUES (t_id, sch_a, 83, 'probe33 empty key', 'mcq',
            '["a","b"]'::jsonb, '{"indexes":[]}'::jsonb, 1);
    r := 'OK: accepted';
  EXCEPTION WHEN check_violation THEN r := 'ERROR: check_violation';
  END;
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('an EMPTY indexes array','-','ERROR: check_violation', r,
     CASE WHEN r = 'ERROR: check_violation' THEN 'PASS' ELSE 'FAIL' END);
  DELETE FROM public.test_questions WHERE test_id = t_id AND order_index = 83;

  -- A numerical key holding a STRING. jsonb equality is typed -- '"4"' <> '4' --
  -- and QuestionRenderer.tsx:134 sends Number(...), so this could never match.
  BEGIN
    INSERT INTO public.test_questions
      (test_id, school_id, order_index, question, question_format, correct, marks)
    VALUES (t_id, sch_a, 84, 'probe33 numeric key as text', 'numerical',
            '{"value":"4"}'::jsonb, 1);
    r := 'OK: accepted';
  EXCEPTION WHEN check_violation THEN r := 'ERROR: check_violation';
  END;
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('a numerical key holding the STRING "4"','-','ERROR: check_violation', r,
     CASE WHEN r = 'ERROR: check_violation' THEN 'PASS' ELSE 'FAIL' END);
  DELETE FROM public.test_questions WHERE test_id = t_id AND order_index = 84;

  -- POSITIVE CONTROL for all three: the LAST valid index must still be accepted.
  -- A trigger that refused everything would pass the three refusals above, and
  -- an off-by-one rejecting index n-1 is the likeliest way to get this wrong.
  BEGIN
    INSERT INTO public.test_questions
      (test_id, school_id, order_index, question, question_format, options, correct, marks)
    VALUES (t_id, sch_a, 85, 'probe33 last valid index', 'mcq',
            '["a","b"]'::jsonb, '{"indexes":[1]}'::jsonb, 1);
    r := 'OK: accepted';
  EXCEPTION WHEN check_violation THEN r := 'ERROR: check_violation';
  END;
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('the LAST valid index, n-1 (positive control)','-','OK: accepted', r,
     CASE WHEN r = 'OK: accepted' THEN 'PASS' ELSE 'FAIL' END);
  DELETE FROM public.test_questions WHERE test_id = t_id AND order_index = 85;

  -- And a valid numerical key, so the numeric refusal above means something.
  BEGIN
    INSERT INTO public.test_questions
      (test_id, school_id, order_index, question, question_format, correct, marks)
    VALUES (t_id, sch_a, 86, 'probe33 numeric key as number', 'numerical',
            '{"value":4}'::jsonb, 1);
    r := 'OK: accepted';
  EXCEPTION WHEN check_violation THEN r := 'ERROR: check_violation';
  END;
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('a numerical key holding the NUMBER 4 (positive control)','-','OK: accepted', r,
     CASE WHEN r = 'OK: accepted' THEN 'PASS' ELSE 'FAIL' END);
  DELETE FROM public.test_questions WHERE test_id = t_id AND order_index = 86;

  -- ── 5/6. marking, both directions, in ONE submit ───────────────────────
  -- Both directions have to ride the same attempt: `test_attempts` carries a
  -- UNIQUE (test_id, user_id) -- `test_attempts_one_per_student` -- so a
  -- student gets exactly one attempt per test, and `rpc_test_submit` closes the
  -- one it marks. Two submits is not an option the app has either.
  INSERT INTO public.test_questions
    (test_id, school_id, order_index, question, question_format, options, correct, marks)
  VALUES (t_id, sch_a, 2, 'probe33 which letter is first', 'mcq',
          '["a","b","c","d"]'::jsonb, '{"indexes":[0]}'::jsonb, 1)
  RETURNING id INTO q_bad;

  INSERT INTO public.test_attempts (test_id, user_id, school_id)
  VALUES (t_id, stu, sch_a) RETURNING id INTO att;

  r := pg_temp.as_user(stu, format(
        'SELECT public.rpc_test_submit(%L::uuid, %L::jsonb)::text', att,
        json_build_array(
          -- q_ok's key is index 1, and index 1 is what is sent: RIGHT, worth 2.
          json_build_object('question_id', q_ok,  'response', json_build_object('indexes', json_build_array(1))),
          -- q_bad's key is index 0, and index 1 is what is sent: WRONG, worth 0.
          json_build_object('question_id', q_bad, 'response', json_build_object('indexes', json_build_array(1)))
        )::text));
  BEGIN
    j := (regexp_replace(r, '^OK: ', ''))::jsonb;
  EXCEPTION WHEN OTHERS THEN j := '{}'::jsonb;
  END;

  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('the RIGHT option scores its marks','student (owns the attempt)','OK: score 2 of 2 marked',
     format('score %s, correct %s of %s', coalesce(j->>'score','?'),
            coalesce(j->>'correct_count','?'), coalesce(j->>'total_count','?')),
     CASE WHEN (j->>'score') = '2' THEN 'PASS' ELSE 'FAIL' END);

  -- Without this a grader that marked everything correct would pass the claim
  -- above: score 2 alone cannot distinguish "one right" from "both right and
  -- the wrong one worth nothing".
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('a WRONG option scores nothing (negative control)','student (owns the attempt)','OK: 1 of 2 correct',
     coalesce(j->>'correct_count','?') || ' of ' || coalesce(j->>'total_count','?') || ' correct',
     CASE WHEN (j->>'correct_count') = '1' AND (j->>'total_count') = '2' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 7. nothing anywhere still keys on the option text ───────────────────
  SELECT count(*) INTO n FROM public.test_questions WHERE jsonb_typeof(correct) = 'string';
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('rows left keying on the option text (all 576 were)','-','0', n::text,
     CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END);

  -- Positive control for claim 7: "0 bad rows" is also what an empty table
  -- reports, and this project's only test data was those 576 rows.
  SELECT count(*) INTO n FROM public.test_questions WHERE question_format IN ('mcq','multi');
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('choice questions still exist to have been repaired (control)','-','> 100', n::text,
     CASE WHEN n > 100 THEN 'PASS' ELSE 'FAIL' END);

  -- ── 8. the key is still withheld from the student ───────────────────────
  INSERT INTO probe(area,role_tested,expected,observed,verdict)
  SELECT 'the attempt path still withholds the answer key','-','absent',
         CASE WHEN d ~ 'q\.correct' OR d ~ 'q\.answer' THEN 'present' ELSE 'absent' END,
         CASE WHEN d ~ 'q\.correct' OR d ~ 'q\.answer' THEN 'FAIL' ELSE 'PASS' END
    FROM (SELECT pg_get_functiondef(p.oid) AS d FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
           WHERE n.nspname='public' AND p.proname='rpc_test_questions_for_attempt') t;
END $probe$;

SELECT area, role_tested, expected, observed, verdict FROM probe ORDER BY n;
ROLLBACK;
