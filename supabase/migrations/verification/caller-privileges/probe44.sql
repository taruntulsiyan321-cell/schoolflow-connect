-- probe44: the TEST journey, end to end, as each real caller.
--
-- "The teacher makes the test from questions, the student of that class sees it
-- and submits it, and as soon as they submit they see a test report." That is
-- the feature in one sentence. probe43 did this for homework; nothing had done
-- it for tests, and the 2026-09-12 session found four defects in the chain that
-- only running it as the actual signed-in people could show:
--
--   * `rpc_test_submit` DELETED `test_answers` at submit, so the student's own
--     report listed the WHOLE PAPER as wrong with their answer shown blank, and
--     the teacher's weakest-topics ranking read 100% wrong on every topic for a
--     class that had averaged 2 of 3 (20260920000000);
--   * every five-argument `_bump_academic_activity` call raised 42725, so a
--     submitted test recorded no activity at all (20260920010000);
--   * a student who had sat NEITHER test in her class could read all six of her
--     classmates' mark rows (20260920060000);
--   * three of the five question formats could never be marked by the only
--     marker that exists (20260920020000).
--
-- THE JOURNEY, AND WHAT EACH HOP PROVES
--   1. a teacher creates a test on a section they teach.       (POSITIVE CONTROL)
--   2. the questions save, and a non-MCQ one is REFUSED.               <- the rule
--   3. a student of that section sees it once published.       (POSITIVE CONTROL)
--   4. a student of another section does NOT.                          <- the fence
--   5. the student cannot read the answer key.                         <- the grant
--   6. ...while the teacher who set it can.                    (POSITIVE CONTROL)
--   7. the student sits it and it is marked automatically.     (POSITIVE CONTROL)
--   8. the per-question answers SURVIVE the submit.                <- the regression
--   9. their report lists only what they got wrong, with their own answer on it.
--  10. a classmate cannot read that report, or that answer sheet.      <- the fence
--  11. the student reads their own.                            (POSITIVE CONTROL)
--  12. a student who HAS submitted reads the leaderboard.      (POSITIVE CONTROL)
--  13. a student who has NOT is refused it, and refused the marks.     <- the fence
--  14. the principal reads the marks...                        (POSITIVE CONTROL)
--  15. ...and is refused the report and the per-question detail.       <- rule 13
--  16. the admin can COUNT the school's tests...               (POSITIVE CONTROL)
--  17. ...and is refused one class's named marks.                      <- the fence
--
-- The positive controls are what make the refusals mean anything: a chain that
-- writes nothing and shows nobody anything satisfies every "cannot" here.
--
-- FIXTURES MUST HOLD AN ACTIVE MEMBERSHIP, for the same reason probe43 says so:
-- `teacher_teaches_class` resolves the caller through `active_local_person_id()`
-- and `is_my_student_record` needs `active_membership_role()`, so a fixture
-- without one "teaches nothing" / "is nobody" and every claim passes vacuously.
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

DO $probe$
DECLARE
  t_id uuid; t_uid uuid; t_class uuid; t_school uuid; t_ss uuid;
  s_id uuid; s_uid uuid; mate_id uuid; mate_uid uuid;
  other_uid uuid; principal_uid uuid; admin_uid uuid;
  the_test uuid; q1 uuid; q2 uuid; att uuid;
  r text;
BEGIN
  -- A teacher with an active membership, teaching a section that HAS A SUBJECT
  -- (a test anchors on section_subject, §10.22) and at least two students who
  -- hold active student memberships.
  SELECT t.id, t.user_id, ss.section_id, t.school_id, ss.id
    INTO t_id, t_uid, t_class, t_school, t_ss
    FROM public.teachers t
    JOIN public.teacher_classes tc ON tc.teacher_id = t.id
    JOIN public.section_subjects ss ON ss.section_id = tc.class_id AND ss.school_id = t.school_id
   WHERE t.deleted_at IS NULL
     AND EXISTS (SELECT 1 FROM public.memberships m
                  WHERE m.account_id = t.user_id AND m.role='teacher'
                    AND m.status='active' AND m.local_person_id = t.id)
     AND (SELECT count(*) FROM public.students s
           WHERE s.class_id = tc.class_id AND s.deleted_at IS NULL
             AND EXISTS (SELECT 1 FROM public.memberships m2
                          WHERE m2.account_id = s.user_id AND m2.role='student'
                            AND m2.status='active' AND m2.local_person_id = s.id)) >= 2
   LIMIT 1;

  IF t_id IS NULL THEN
    INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
      ('fixture: a membership-holding teacher, a section WITH A SUBJECT, 2 membership-holding students','-',
       'found','NOT FOUND — this probe can assert nothing without it','FAIL');
    RETURN;
  END IF;

  SELECT s.id, s.user_id INTO s_id, s_uid
    FROM public.students s
   WHERE s.class_id = t_class AND s.deleted_at IS NULL
     AND EXISTS (SELECT 1 FROM public.memberships m
                  WHERE m.account_id = s.user_id AND m.role='student'
                    AND m.status='active' AND m.local_person_id = s.id)
   ORDER BY s.id LIMIT 1;

  SELECT s.id, s.user_id INTO mate_id, mate_uid
    FROM public.students s
   WHERE s.class_id = t_class AND s.deleted_at IS NULL AND s.id <> s_id
     AND EXISTS (SELECT 1 FROM public.memberships m
                  WHERE m.account_id = s.user_id AND m.role='student'
                    AND m.status='active' AND m.local_person_id = s.id)
   ORDER BY s.id LIMIT 1;

  -- A student of ANOTHER section of the same school, for claim 4.
  SELECT s.user_id INTO other_uid
    FROM public.students s
   WHERE s.school_id = t_school AND s.class_id IS DISTINCT FROM t_class
     AND s.deleted_at IS NULL AND s.user_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.memberships m
                  WHERE m.account_id = s.user_id AND m.role='student'
                    AND m.status='active' AND m.local_person_id = s.id)
   ORDER BY s.id LIMIT 1;

  SELECT m.account_id INTO principal_uid FROM public.memberships m
   WHERE m.role='principal' AND m.status='active' AND m.school_id = t_school LIMIT 1;
  SELECT m.account_id INTO admin_uid FROM public.memberships m
   WHERE m.role='admin' AND m.status='active' AND m.school_id = t_school LIMIT 1;

  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('fixture: the actors this probe tested','-','named',
     'teacher=' || t_uid::text || ' | section=' || t_class::text
       || ' | student=' || s_id::text
       || ' | classmate=' || COALESCE(mate_id::text,'(none)')
       || ' | other-section student=' || COALESCE(other_uid::text,'(none)')
       || ' | principal=' || COALESCE(principal_uid::text,'(none)')
       || ' | admin=' || COALESCE(admin_uid::text,'(none)'),
     CASE WHEN s_id IS NOT NULL AND mate_id IS NOT NULL THEN 'PASS' ELSE 'FAIL' END);

  -- ── 1. the teacher creates the test (POSITIVE CONTROL) ─────────────────
  r := pg_temp.as_user(t_uid, format(
    $q$WITH i AS (INSERT INTO public.tests
                   (school_id, section_subject_id, created_by, title, max_mark, total_marks,
                    status, test_kind, duration_sec)
                  VALUES (%L, %L, %L, 'probe44 test', 2, 2, 'draft', 'class_test', 900)
                  RETURNING 1) SELECT count(*)::text FROM i$q$, t_school, t_ss, t_uid));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('a teacher creates a test on a section they teach (positive control)','teacher','OK: 1', r,
     CASE WHEN r = 'OK: 1' THEN 'PASS' ELSE 'FAIL' END);

  SELECT id INTO the_test FROM public.tests WHERE title = 'probe44 test' ORDER BY created_at DESC LIMIT 1;
  IF the_test IS NULL THEN RETURN; END IF;

  -- ── 2. the questions save, and a written one is refused ────────────────
  r := pg_temp.as_user(t_uid, format(
    $q$WITH i AS (INSERT INTO public.test_questions
                   (test_id, school_id, order_index, question_format, question, options, correct, marks, explanation, concept)
                  VALUES (%L, %L, 0, 'mcq', 'probe44: 2 + 2 ?', '["3","4"]', '{"indexes":[1]}', 1, 'four', 'Addition'),
                         (%L, %L, 1, 'mcq', 'probe44: 3 + 3 ?', '["6","7"]', '{"indexes":[0]}', 1, 'six', 'Addition')
                  RETURNING 1) SELECT count(*)::text FROM i$q$, the_test, t_school, the_test, t_school));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('the teacher''s two MCQs save (positive control)','teacher','OK: 2', r,
     CASE WHEN r = 'OK: 2' THEN 'PASS' ELSE 'FAIL' END);

  SELECT id INTO q1 FROM public.test_questions WHERE test_id = the_test AND order_index = 0;
  SELECT id INTO q2 FROM public.test_questions WHERE test_id = the_test AND order_index = 1;

  -- An online test holds MCQs only: a written question cannot be marked by
  -- anything in this product, so the table refuses it (20260920020000).
  r := pg_temp.as_user(t_uid, format(
    $q$WITH i AS (INSERT INTO public.test_questions
                   (test_id, school_id, order_index, question_format, question, answer, marks)
                  VALUES (%L, %L, 9, 'short', 'probe44: explain', 'because', 1)
                  RETURNING 1) SELECT count(*)::text FROM i$q$, the_test, t_school));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('a written question is refused — an online test is all MCQ','teacher','ERROR', r,
     CASE WHEN r LIKE 'ERROR:%' THEN 'PASS' ELSE 'FAIL' END);

  -- publish it
  r := pg_temp.as_user(t_uid, format(
    $q$WITH u AS (UPDATE public.tests SET status='published', published_at=now()
                   WHERE id = %L RETURNING 1) SELECT count(*)::text FROM u$q$, the_test));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('the teacher publishes it (positive control)','teacher','OK: 1', r,
     CASE WHEN r = 'OK: 1' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 3. a student of that section sees it (POSITIVE CONTROL) ────────────
  r := pg_temp.as_user(s_uid, format(
    $q$SELECT count(*)::text FROM public.tests WHERE id = %L$q$, the_test));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('a student of that section sees the published test (positive control)','student','OK: 1', r,
     CASE WHEN r = 'OK: 1' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 4. a student of another section does not ───────────────────────────
  IF other_uid IS NOT NULL THEN
    r := pg_temp.as_user(other_uid, format(
      $q$SELECT count(*)::text FROM public.tests WHERE id = %L$q$, the_test));
    INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
      ('a student of ANOTHER section sees nothing','student (other section)','OK: 0', r,
       CASE WHEN r = 'OK: 0' THEN 'PASS' ELSE 'FAIL' END);
  END IF;

  -- ── 5/6. the answer key: closed to the student, open to its author ─────
  r := pg_temp.as_user(s_uid, format(
    $q$SELECT count(*)::text FROM public.test_questions WHERE test_id = %L$q$, the_test));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('the answer key is not SELECT-able by the student','student','OK: 0', r,
     CASE WHEN r = 'OK: 0' THEN 'PASS' ELSE 'FAIL' END);

  r := pg_temp.as_user(t_uid, format(
    $q$SELECT count(*)::text FROM public.test_questions WHERE test_id = %L$q$, the_test));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('...while the teacher who set it reads it (positive control)','teacher','OK: 2', r,
     CASE WHEN r = 'OK: 2' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 7. the student sits it, and it marks itself ────────────────────────
  r := pg_temp.as_user(s_uid, format($q$SELECT public.rpc_test_start(%L)::text$q$, the_test));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('the student starts the attempt (positive control)','student','OK: <uuid>', r,
     CASE WHEN r LIKE 'OK: %-%' THEN 'PASS' ELSE 'FAIL' END);

  SELECT id INTO att FROM public.test_attempts WHERE test_id = the_test AND user_id = s_uid LIMIT 1;

  -- One right, one wrong, carrying the timing the attempt screen now records.
  r := pg_temp.as_user(s_uid, format(
    $q$SELECT (public.rpc_test_submit(%L, jsonb_build_array(
         jsonb_build_object('question_id', %L::uuid, 'response', '{"indexes":[1]}'::jsonb, 'time_ms', 4000),
         jsonb_build_object('question_id', %L::uuid, 'response', '{"indexes":[1]}'::jsonb, 'time_ms', 6000)
       )) ->> 'score')$q$, att, q1, q2));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('submitting marks it automatically: 1 of 2','student','OK: 1', r,
     CASE WHEN r = 'OK: 1' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 8. the answers survive (the regression this chain was built for) ───
  r := pg_temp.as_user(s_uid, format(
    $q$SELECT count(*)::text FROM public.test_answers WHERE attempt_id = %L$q$, att));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('the per-question answers SURVIVE the submit','student','OK: 2', r,
     CASE WHEN r = 'OK: 2' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 9. the report says one wrong, with their own answer on it ──────────
  r := pg_temp.as_user(s_uid, format(
    $q$SELECT jsonb_array_length(public.rpc_test_student_report(%L,%L) -> 'wrong_answers')::text$q$,
    the_test, s_id));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('their report lists ONE wrong answer, not the whole paper','student','OK: 1', r,
     CASE WHEN r = 'OK: 1' THEN 'PASS' ELSE 'FAIL' END);

  r := pg_temp.as_user(s_uid, format(
    $q$SELECT (public.rpc_test_student_report(%L,%L) -> 'wrong_answers' -> 0 ->> 'answered')$q$,
    the_test, s_id));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('...and knows they answered it, rather than showing it blank','student','OK: true', r,
     CASE WHEN r = 'OK: true' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 10/11. one student's paper is not another's ────────────────────────
  r := pg_temp.as_user(mate_uid, format(
    $q$SELECT public.rpc_test_student_report(%L,%L)::text$q$, the_test, s_id));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('a classmate cannot read that student''s report','student (classmate)','ERROR', r,
     CASE WHEN r LIKE 'ERROR:%' THEN 'PASS' ELSE 'FAIL' END);

  r := pg_temp.as_user(mate_uid, format(
    $q$SELECT public.rpc_test_answer_sheet(%L,%L)::text$q$, the_test, s_id));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('...nor their answer sheet','student (classmate)','ERROR', r,
     CASE WHEN r LIKE 'ERROR:%' THEN 'PASS' ELSE 'FAIL' END);

  r := pg_temp.as_user(s_uid, format(
    $q$SELECT jsonb_array_length(public.rpc_test_answer_sheet(%L,%L) -> 'questions')::text$q$,
    the_test, s_id));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('the student reads their OWN answer sheet (positive control)','student','OK: 2', r,
     CASE WHEN r = 'OK: 2' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 12/13. the leaderboard is for those who have handed in ─────────────
  r := pg_temp.as_user(s_uid, format(
    $q$SELECT jsonb_array_length(public.rpc_test_leaderboard(%L) -> 'entries')::text$q$, the_test));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('a student who submitted reads the leaderboard (positive control)','student','OK: 1', r,
     CASE WHEN r = 'OK: 1' THEN 'PASS' ELSE 'FAIL' END);

  r := pg_temp.as_user(mate_uid, format(
    $q$SELECT public.rpc_test_leaderboard(%L)::text$q$, the_test));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('a classmate who has NOT submitted is refused it','student (not sat)','ERROR', r,
     CASE WHEN r LIKE 'ERROR:%' THEN 'PASS' ELSE 'FAIL' END);

  r := pg_temp.as_user(mate_uid, format(
    $q$SELECT count(*)::text FROM public.test_marks WHERE test_id = %L$q$, the_test));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('...and reads none of its marks either','student (not sat)','OK: 0', r,
     CASE WHEN r = 'OK: 0' THEN 'PASS' ELSE 'FAIL' END);

  r := pg_temp.as_user(s_uid, format(
    $q$SELECT count(*)::text FROM public.test_marks WHERE test_id = %L AND student_id = %L$q$, the_test, s_id));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('the sitter reads their own mark (positive control)','student','OK: 1', r,
     CASE WHEN r = 'OK: 1' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 14/15. the principal: marks, not the paper ─────────────────────────
  IF principal_uid IS NOT NULL THEN
    r := pg_temp.as_user(principal_uid, format(
      $q$SELECT (public.rpc_test_class_marks(%L) ->> 'submitted_count')$q$, the_test));
    INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
      ('the principal reads the class''s marks (positive control)','principal','OK: 1', r,
       CASE WHEN r = 'OK: 1' THEN 'PASS' ELSE 'FAIL' END);

    r := pg_temp.as_user(principal_uid, format(
      $q$SELECT public.rpc_test_class_report(%L)::text$q$, the_test));
    INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
      ('...and is refused the teacher''s report','principal','ERROR', r,
       CASE WHEN r LIKE 'ERROR:%' THEN 'PASS' ELSE 'FAIL' END);

    r := pg_temp.as_user(principal_uid, format(
      $q$SELECT public.rpc_test_student_report(%L,%L)::text$q$, the_test, s_id));
    INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
      ('...and refused a named child''s per-question detail (rule 13)','principal','ERROR', r,
       CASE WHEN r LIKE 'ERROR:%' THEN 'PASS' ELSE 'FAIL' END);
  END IF;

  -- ── 16/17. the admin: counts, not one class's named marks ──────────────
  IF admin_uid IS NOT NULL THEN
    r := pg_temp.as_user(admin_uid, format(
      $q$SELECT (count(*) > 0)::text FROM public.tests WHERE school_id = %L AND deleted_at IS NULL$q$, t_school));
    INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
      ('the admin can count the school''s tests (positive control)','admin','OK: true', r,
       CASE WHEN r = 'OK: true' THEN 'PASS' ELSE 'FAIL' END);

    r := pg_temp.as_user(admin_uid, format(
      $q$SELECT public.rpc_test_class_marks(%L)::text$q$, the_test));
    INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
      ('...and is refused one class''s named marks','admin','ERROR', r,
       CASE WHEN r LIKE 'ERROR:%' THEN 'PASS' ELSE 'FAIL' END);
  END IF;
END $probe$;

SELECT area, role_tested, expected, observed, verdict FROM probe ORDER BY n;
ROLLBACK;
