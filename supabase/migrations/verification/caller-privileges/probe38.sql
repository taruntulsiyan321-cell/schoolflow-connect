-- probe38: the teacher test report reaches its own class and nobody else
-- (§10.25, §10.19, §10.23).
--
-- THE ROLE SET IS RULED, 2026-09-09, and this file is the record of it.
-- `docs/locked-decisions.md` §10.25 named teacher · principal · the student ·
-- parent (own child only). The build instruction said "Principal sees
-- nothing." Asked to settle it, the user ruled:
--
--     "Admin and Principal sees nothing. Teacher get a test report. Student
--      get their own reports plus leaderboard. Parents get their own child
--      reports."
--
-- So the principal exclusion stands, the ADMIN joins it — they had been
-- admitted by the first build and by no ruling — and the parent is admitted
-- for their own child alone. Applied by `20260916030000`; claims 15-19 hold it.
--
-- THE CLAIMS
--   1. the sessions are genuinely who they say.               (harness control)
--   2. the teacher who teaches the section GETS the report.   (POSITIVE CONTROL)
--   3. ...and it carries real numbers, not an empty shell.    (POSITIVE CONTROL)
--   4. a teacher of ANOTHER class is refused.                      <- the fence
--   5. the PRINCIPAL is refused entirely.                          <- fail-closed
--   6. a student is refused the CLASS report.                      <- the fence
--   7. the student GETS their own drill-down.                 (POSITIVE CONTROL)
--   8. ...and it lists only what they got WRONG.                   <- §10.25
--   9. a student is refused ANOTHER student's drill-down.          <- the fence
--  10. anon is refused outright.                                   <- the grant
--  11. a student is refused a test they NEVER SAT.                 <- 20260916020000
--  12. ...including one in ANOTHER SCHOOL.                         <- 20260916020000
--  13. a non-sitter's report is empty and says so, not the paper.  <- 20260916020000
--  14. a wrong answer carries its options, so it can be read.  (POSITIVE CONTROL)
--  15. the ADMIN is refused, by role AND by authorship.            <- ruling
--  16. a PARENT reaches their own child's report.             (POSITIVE CONTROL)
--  17. ...and not another family's child.                          <- the fence
--  18. ...and never the class list, nor a test not sat.            <- the fence
--  19. the student's report carries a leaderboard RANK.       (POSITIVE CONTROL)
--
-- 2, 3 and 7 are what make the refusals mean anything. A report that returns
-- nothing to everybody satisfies every denial here while being useless.
--
-- CLAIMS 11-13 EXIST BECAUSE THE FIRST BUILD FAILED THEM, LIVE. The student
-- branch of `can_read_test_student_report` checked only "is this my student
-- row" and never what the test id had to do with that student, and the body
-- built `wrong_answers` from a LEFT JOIN that matches EVERY question when
-- there is no attempt. Measured 2026-09-09: a school-A student read all 8
-- questions of a school-B test WITH their correct answers, while the same
-- student's direct SELECT on `tests` and on `test_questions` each returned 0
-- rows. Closed by `20260916020000`.
--
-- The fixture is built inside the transaction because all 72 seeded tests
-- belong to the other school, so this teacher's sections have none.
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

CREATE FUNCTION pg_temp.as_anon(_sql text) RETURNS text
LANGUAGE plpgsql AS $fn$
DECLARE _out text;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('role','anon')::text, true);
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
  sch_a     uuid := '00000000-0000-4000-8000-000000000001';
  cls10     uuid := 'd2000001-0001-4000-8000-000000000001';
  cls12     uuid := 'd2000001-0012-4000-8000-000000000012';
  teacher   uuid;   -- Priya — teaches 10-A
  other_t   uuid;   -- teaches 10-A but NOT 12-A (Rajesh)
  principal uuid;
  admin_u   uuid;   -- the office, refused by the 2026-09-09 ruling
  par_a     uuid;   -- guardian of stu_a
  par_b     uuid;   -- guardian of stu_b — a DIFFERENT family
  ss        uuid;
  ss12      uuid;
  t_id      uuid;
  t12       uuid;   -- a test on 12-A, which Priya teaches and Rajesh does not
  t_unsat   uuid;   -- a published test on 10-A that nobody attempts
  t_foreign uuid;   -- a real test in the OTHER school, read, never written
  q1        uuid;
  q2        uuid;
  stu_a     uuid;   -- a 10-A student, the one who sits the test
  stu_b     uuid;   -- another 10-A student
  stu_a_uid uuid;
  att       uuid;
  r         text;
BEGIN
  SELECT id INTO teacher   FROM auth.users WHERE email = 'priya.sharma@wisdomcampus.com';
  SELECT id INTO principal FROM auth.users WHERE email = 'principal@wisdomcampus.com';
  SELECT id INTO admin_u   FROM auth.users WHERE email = 'admin@wisdomcampus.com';

  SELECT s.id INTO ss FROM public.section_subjects s
   WHERE s.section_id = cls10 AND s.school_id = sch_a LIMIT 1;

  -- A teacher of this school who does NOT teach 10-A.
  --
  -- SELECTED FROM THE RAW TABLES, NOT VIA `teacher_teaches_class`. That
  -- function branches on `_user_id = auth.uid()` and calls `same_school()`,
  -- and BOTH depend on the caller's session — so evaluated here, as `postgres`
  -- with no JWT, `same_school()` is false and it reports "teaches nothing" for
  -- every teacher alive. The first version of this probe picked Rajesh Verma
  -- that way and then failed when he was admitted, which was correct: he
  -- teaches 10-A. A fixture chosen with a predicate that cannot be evaluated
  -- in the choosing session is how a probe invents a leak that is not there.
  -- ALL THREE school-A teachers are linked to 10-A, so "a teacher who does not
  -- teach this class" cannot be found for 10-A at all. 12-A is the class that
  -- separates them — Priya teaches it, Rajesh does not — which is the same
  -- split probe9 relies on. The refusal claim therefore runs against a second
  -- test on 12-A, and the student claims stay on 10-A because 12-A holds only
  -- one student and claim 9 needs two.
  SELECT t.user_id INTO other_t
    FROM public.teachers t
   WHERE t.school_id = sch_a AND t.user_id IS NOT NULL AND t.user_id <> teacher
     AND NOT EXISTS (
       SELECT 1 FROM public.teacher_classes tc
        WHERE tc.teacher_id = t.id AND tc.class_id = cls12)
     AND COALESCE(t.class_teacher_of, '00000000-0000-0000-0000-000000000000'::uuid) <> cls12
   LIMIT 1;

  SELECT s.id INTO ss12 FROM public.section_subjects s
   WHERE s.section_id = cls12 AND s.school_id = sch_a LIMIT 1;

  -- BOTH students must carry a GUARDIAN, and two DIFFERENT guardians, or the
  -- parent claims below cannot tell "not my child" from "no parent link at
  -- all". Two 10-A students qualify (measured 2026-09-09), which is exactly
  -- enough: one is the sitter, the other is the other family.
  SELECT s.id, s.user_id, s.parent_user_id INTO stu_a, stu_a_uid, par_a
    FROM public.students s
   WHERE s.class_id = cls10 AND s.school_id = sch_a
     AND s.user_id IS NOT NULL AND s.parent_user_id IS NOT NULL
   ORDER BY s.id LIMIT 1;

  SELECT s.id, s.parent_user_id INTO stu_b, par_b
    FROM public.students s
   WHERE s.class_id = cls10 AND s.school_id = sch_a AND s.id <> stu_a
     AND s.parent_user_id IS NOT NULL AND s.parent_user_id <> par_a
   ORDER BY s.id LIMIT 1;

  IF teacher IS NULL OR principal IS NULL OR admin_u IS NULL OR ss IS NULL
     OR ss12 IS NULL OR other_t IS NULL OR stu_a IS NULL OR stu_b IS NULL
     OR par_a IS NULL OR par_b IS NULL THEN
    RAISE EXCEPTION
      'probe38: fixtures missing (teacher=%, principal=%, admin=%, ss=%, ss12=%, other_teacher=%, '
      'stu_a=%, stu_b=%, parent_a=%, parent_b=%) — a skipped check is not a passing check',
      teacher, principal, admin_u, ss, ss12, other_t, stu_a, stu_b, par_a, par_b;
  END IF;

  -- ── fixture: a published test on 10-A with two questions, one answered
  --    right and one wrong, submitted by stu_a ─────────────────────────────
  INSERT INTO public.tests (school_id, section_subject_id, created_by, title,
                            max_mark, total_marks, status, test_kind, duration_sec, published_at)
  VALUES (sch_a, ss, teacher, 'probe38 report fixture', 2, 2, 'published', 'class_test', 600, now())
  RETURNING id INTO t_id;

  INSERT INTO public.test_questions (test_id, school_id, order_index, question,
                                     options, correct, marks, question_format, concept)
  VALUES (t_id, sch_a, 0, 'probe38 Q1 — 2+2?', '["3","4"]'::jsonb, '{"indexes":[1]}'::jsonb, 1, 'mcq', 'Addition')
  RETURNING id INTO q1;

  INSERT INTO public.test_questions (test_id, school_id, order_index, question,
                                     options, correct, marks, question_format, concept)
  VALUES (t_id, sch_a, 1, 'probe38 Q2 — 3x3?', '["6","9"]'::jsonb, '{"indexes":[1]}'::jsonb, 1, 'mcq', 'Multiplication')
  RETURNING id INTO q2;

  INSERT INTO public.test_attempts (test_id, student_id, user_id, school_id,
                                    started_at, submitted_at, status,
                                    score, correct_count, total_count)
  VALUES (t_id, stu_a, stu_a_uid, sch_a, now(), now(), 'submitted', 1, 1, 2)
  RETURNING id INTO att;

  INSERT INTO public.test_answers (attempt_id, question_id, school_id, response, is_correct, marks_awarded, time_ms)
  VALUES (att, q1, sch_a, '{"indexes":[1]}'::jsonb, true,  1, 12000),
         (att, q2, sch_a, '{"indexes":[0]}'::jsonb, false, 0, 30000);

  -- fixture 2: a test on 12-A, so "a teacher of another class" is a real role
  -- and not a synonym for "another school".
  INSERT INTO public.tests (school_id, section_subject_id, created_by, title,
                            max_mark, total_marks, status, test_kind, duration_sec, published_at)
  VALUES (sch_a, ss12, teacher, 'probe38 other-class fixture', 1, 1, 'published', 'class_test', 600, now())
  RETURNING id INTO t12;

  -- fixture 3: a PUBLISHED test on this student's own class that nobody sits.
  -- Same class, same subject, same teacher — the ONLY difference from t_id is
  -- that there is no attempt, so claim 11 cannot pass for a second reason.
  INSERT INTO public.tests (school_id, section_subject_id, created_by, title,
                            max_mark, total_marks, status, test_kind, duration_sec, published_at)
  VALUES (sch_a, ss, teacher, 'probe38 never-sat fixture', 1, 1, 'published', 'class_test', 600, now())
  RETURNING id INTO t_unsat;

  INSERT INTO public.test_questions (test_id, school_id, order_index, question,
                                     options, correct, marks, question_format, concept)
  VALUES (t_unsat, sch_a, 0, 'probe38 unsat Q1 — 5+5?', '["10","11"]'::jsonb, '{"indexes":[0]}'::jsonb, 1, 'mcq', 'Addition');

  -- fixture 4 is not written: a test in the other school already exists, and
  -- reading one is the honest fixture for "another tenant's paper".
  SELECT t.id INTO t_foreign
    FROM public.tests t
   WHERE t.school_id <> sch_a
     AND t.deleted_at IS NULL
     AND EXISTS (SELECT 1 FROM public.test_questions q WHERE q.test_id = t.id)
   ORDER BY t.id LIMIT 1;

  IF t_foreign IS NULL THEN
    RAISE EXCEPTION 'probe38: no foreign-school test with questions — claim 12 cannot run, '
                    'and a check that cannot run is not a check that passed';
  END IF;

  -- ── 1. the sessions are real ────────────────────────────────────────────
  r := pg_temp.as_user(teacher, 'SELECT public.get_my_role()::text');
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('the teacher session really is a teacher (control)','teacher','OK: teacher', r,
     CASE WHEN r = 'OK: teacher' THEN 'PASS' ELSE 'FAIL' END);

  r := pg_temp.as_user(principal, 'SELECT public.get_my_role()::text');
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('the principal session really is a principal (control)','principal','OK: principal', r,
     CASE WHEN r = 'OK: principal' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 2/3. the teacher gets a report, and it has real numbers ─────────────
  r := pg_temp.as_user(teacher, format(
        $q$SELECT (public.rpc_test_class_report(%L) ->> 'submitted_count')$q$, t_id));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('class report reaches the teacher of that section (positive control)','teacher who teaches 10-A','OK: 1', r,
     CASE WHEN r = 'OK: 1' THEN 'PASS' ELSE 'FAIL' END);

  r := pg_temp.as_user(teacher, format(
        $q$SELECT (public.rpc_test_class_report(%L) -> 'weakest_topics' -> 0 ->> 'topic')$q$, t_id));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('...and it ranks the topic they actually got wrong (positive control)','teacher','OK: Multiplication', r,
     CASE WHEN r = 'OK: Multiplication' THEN 'PASS' ELSE 'FAIL' END);

  r := pg_temp.as_user(teacher, format(
        $q$SELECT jsonb_array_length(public.rpc_test_class_report(%L) -> 'students')::text$q$, t_id));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('...and the full class list is present, not just the sitters (positive control)','teacher','OK: > 1', r,
     CASE WHEN r LIKE 'OK: %' AND r <> 'OK: 0' AND r <> 'OK: 1' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 4. a teacher of another class, and its positive control ────────────
  r := pg_temp.as_user(other_t, format(
        $q$SELECT (public.rpc_test_class_report(%L) ->> 'submitted_count')$q$, t12));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('class report for a section they do NOT teach','teacher of 10-A, asked about 12-A','ERROR: Not your class', r,
     CASE WHEN r LIKE 'ERROR:%Not your class%' THEN 'PASS' ELSE 'FAIL' END);

  -- The same report MUST reach the teacher who does teach 12-A, or the refusal
  -- above proves only that the 12-A report is unreachable to everybody.
  r := pg_temp.as_user(teacher, format(
        $q$SELECT (public.rpc_test_class_report(%L) ->> 'title')$q$, t12));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('...while the teacher who DOES teach 12-A gets it (positive control)','teacher of 12-A','OK: probe38 other-class fixture', r,
     CASE WHEN r = 'OK: probe38 other-class fixture' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 5. the principal, refused entirely ──────────────────────────────────
  r := pg_temp.as_user(principal, format(
        $q$SELECT (public.rpc_test_class_report(%L) ->> 'submitted_count')$q$, t_id));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('class report — fail-closed build refuses the principal','principal','ERROR: Not your class', r,
     CASE WHEN r LIKE 'ERROR:%Not your class%' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 6. a student cannot have the class report ───────────────────────────
  r := pg_temp.as_user(stu_a_uid, format(
        $q$SELECT (public.rpc_test_class_report(%L) ->> 'submitted_count')$q$, t_id));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('class report — a student may never see the class aggregate','student who sat it','ERROR: Not your class', r,
     CASE WHEN r LIKE 'ERROR:%Not your class%' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 7/8. the student gets their OWN drill-down, wrong answers only ──────
  r := pg_temp.as_user(stu_a_uid, format(
        $q$SELECT (public.rpc_test_student_report(%L,%L) ->> 'mark')$q$, t_id, stu_a));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('their own drill-down reaches them (positive control)','student who sat it','OK: 1', r,
     CASE WHEN r = 'OK: 1' THEN 'PASS' ELSE 'FAIL' END);

  r := pg_temp.as_user(stu_a_uid, format(
        $q$SELECT jsonb_array_length(public.rpc_test_student_report(%L,%L) -> 'wrong_answers')::text$q$, t_id, stu_a));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('...listing ONLY the one they got wrong, never the right one (§10.25)','student','OK: 1', r,
     CASE WHEN r = 'OK: 1' THEN 'PASS' ELSE 'FAIL' END);

  r := pg_temp.as_user(stu_a_uid, format(
        $q$SELECT (public.rpc_test_student_report(%L,%L) -> 'wrong_answers' -> 0 ->> 'topic')$q$, t_id, stu_a));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('...with the topic on it (positive control)','student','OK: Multiplication', r,
     CASE WHEN r = 'OK: Multiplication' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 9. and not another student's ────────────────────────────────────────
  r := pg_temp.as_user(stu_a_uid, format(
        $q$SELECT (public.rpc_test_student_report(%L,%L) ->> 'mark')$q$, t_id, stu_b));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('ANOTHER student''s drill-down','student','ERROR: Not your test report', r,
     CASE WHEN r LIKE 'ERROR:%Not your test report%' THEN 'PASS' ELSE 'FAIL' END);

  -- ...while the teacher CAN reach that same student (positive control): the
  -- refusal above must be about whose report it is, not about the report being
  -- unreachable to everyone.
  r := pg_temp.as_user(teacher, format(
        $q$SELECT (public.rpc_test_student_report(%L,%L) ->> 'full_name')$q$, t_id, stu_b));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('...which the TEACHER can still reach (positive control)','teacher','OK: <a name>', r,
     CASE WHEN r LIKE 'OK: %' AND r <> 'OK: null' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 10. anon ────────────────────────────────────────────────────────────
  r := pg_temp.as_anon(format(
        $q$SELECT (public.rpc_test_class_report(%L) ->> 'submitted_count')$q$, t_id));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('class report','anon (the browser-bundle key)','ERROR: permission denied', r,
     CASE WHEN r LIKE 'ERROR:%permission denied%' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 11. a test they never sat — the answer key BEFORE the exam ──────────
  --
  -- The positive control for 11 and 12 is claim 7 above: the SAME student, on
  -- the test they DID submit, reads their own report. So a refusal here is
  -- about this test, not about the student being locked out of everything.
  r := pg_temp.as_user(stu_a_uid, format(
        $q$SELECT jsonb_array_length(public.rpc_test_student_report(%L,%L) -> 'wrong_answers')::text$q$,
        t_unsat, stu_a));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('own report on a published test they NEVER SAT','student in that class','ERROR: Not your test report', r,
     CASE WHEN r LIKE 'ERROR:%Not your test report%' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 12. ...and a test belonging to another school entirely ──────────────
  r := pg_temp.as_user(stu_a_uid, format(
        $q$SELECT (public.rpc_test_student_report(%L,%L) -> 'wrong_answers' -> 0 ->> 'correct_answer')$q$,
        t_foreign, stu_a));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('another SCHOOL''s paper, asked for with their own student id','student of school A','ERROR: Not your test report', r,
     CASE WHEN r LIKE 'ERROR:%Not your test report%' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 13. staff reach a non-sitter, and get an empty report that SAYS so ──
  --
  -- The teacher is legitimately admitted here; the defect this catches is not
  -- disclosure but misrepresentation. Before 20260916020000 this returned
  -- every question of the test as "what they got wrong", for a student who
  -- sat nothing. stu_b has no attempt on t_id.
  r := pg_temp.as_user(teacher, format(
        $q$SELECT jsonb_array_length(public.rpc_test_student_report(%L,%L) -> 'wrong_answers')::text$q$,
        t_id, stu_b));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('a student who did not sit it has NO wrong answers','teacher','OK: 0', r,
     CASE WHEN r = 'OK: 0' THEN 'PASS' ELSE 'FAIL' END);

  r := pg_temp.as_user(teacher, format(
        $q$SELECT (public.rpc_test_student_report(%L,%L) ->> 'submitted')$q$, t_id, stu_b));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('...and the report says they did not sit it, not "nothing wrong"','teacher','OK: false', r,
     CASE WHEN r = 'OK: false' THEN 'PASS' ELSE 'FAIL' END);

  -- ...while the sitter's own report still says submitted (positive control):
  -- otherwise `submitted` could be hard-false and claim 13 would pass on a
  -- field that never says anything else.
  r := pg_temp.as_user(teacher, format(
        $q$SELECT (public.rpc_test_student_report(%L,%L) ->> 'submitted')$q$, t_id, stu_a));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('...and true for the one who did (positive control)','teacher','OK: true', r,
     CASE WHEN r = 'OK: true' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 14. a wrong answer carries the options it was chosen from ───────────
  --
  -- `their_answer` and `correct_answer` are POSITIONS ({"indexes":[i]}), not
  -- text. Without the option list beside them a screen has nothing to render
  -- but raw jsonb. Q2's options are ["6","9"] and the key is index 1.
  r := pg_temp.as_user(stu_a_uid, format(
        $q$SELECT (public.rpc_test_student_report(%L,%L) -> 'wrong_answers' -> 0 -> 'options' ->> 1)$q$,
        t_id, stu_a));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('the wrong answer carries its options (positive control)','student','OK: 9', r,
     CASE WHEN r = 'OK: 9' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 15. the office. USER RULING 2026-09-09: "Admin and Principal sees
  --        nothing." The admin was admitted by 20260916000000's fence and by
  --        nothing anyone had ruled. Claim 2 above is its positive control —
  --        the same report reaches the teacher who teaches the section.
  r := pg_temp.as_user(admin_u, format(
        $q$SELECT (public.rpc_test_class_report(%L) ->> 'submitted_count')$q$, t_id));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('class report — the ADMIN is refused (ruling)','admin of this school','ERROR: Not your class', r,
     CASE WHEN r LIKE 'ERROR:%Not your class%' THEN 'PASS' ELSE 'FAIL' END);

  -- ...and not through authorship either. The admin branch and `created_by`
  -- were the same door with two keys, so removing one and keeping the other
  -- would leave this passing while the rule stayed broken.
  r := pg_temp.as_user(admin_u, format(
        $q$SELECT public.can_read_test_report(%L)::text$q$, t12));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('...on any test in their own school','admin','OK: false', r,
     CASE WHEN r = 'OK: false' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 16. the parent of the sitter — the widening the ruling asked for ────
  r := pg_temp.as_user(par_a, format(
        $q$SELECT jsonb_array_length(public.rpc_test_student_report(%L,%L) -> 'wrong_answers')::text$q$,
        t_id, stu_a));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('their OWN child''s report reaches the parent (positive control)','parent of the sitter','OK: 1', r,
     CASE WHEN r = 'OK: 1' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 17. and not another family's child ─────────────────────────────────
  r := pg_temp.as_user(par_b, format(
        $q$SELECT (public.rpc_test_student_report(%L,%L) ->> 'mark')$q$, t_id, stu_a));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('ANOTHER family''s child','parent of a different 10-A child','ERROR: Not your test report', r,
     CASE WHEN r LIKE 'ERROR:%Not your test report%' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 18. the class aggregate stays shut to the parent ───────────────────
  --        "Parents get their own child reports" — the class list is every
  --        other family's marks.
  r := pg_temp.as_user(par_a, format(
        $q$SELECT (public.rpc_test_class_report(%L) ->> 'submitted_count')$q$, t_id));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('class report — a parent may never see the class list','parent of the sitter','ERROR: Not your class', r,
     CASE WHEN r LIKE 'ERROR:%Not your class%' THEN 'PASS' ELSE 'FAIL' END);

  -- ...and a parent is refused a test their child never sat, same as the
  -- child is (20260916020000 carried into the parent branch).
  r := pg_temp.as_user(par_a, format(
        $q$SELECT (public.rpc_test_student_report(%L,%L) ->> 'mark')$q$, t_unsat, stu_a));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('...and a test their child NEVER SAT','parent','ERROR: Not your test report', r,
     CASE WHEN r LIKE 'ERROR:%Not your test report%' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 19. "student get their own reports plus leaderboard" ───────────────
  --        A POSITION, not a list of names. stu_a is the only submitter, so
  --        the rank is 1 of 1 — and `class_size` proves the field is computed
  --        rather than hard-coded, because a rank of 1 alone would pass on a
  --        constant.
  r := pg_temp.as_user(stu_a_uid, format(
        $q$SELECT (public.rpc_test_student_report(%L,%L) ->> 'rank')$q$, t_id, stu_a));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('their own report carries a leaderboard rank (ruling)','student','OK: 1', r,
     CASE WHEN r = 'OK: 1' THEN 'PASS' ELSE 'FAIL' END);

  r := pg_temp.as_user(stu_a_uid, format(
        $q$SELECT (public.rpc_test_student_report(%L,%L) ->> 'class_size')$q$, t_id, stu_a));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('...out of the number who sat it','student','OK: 1', r,
     CASE WHEN r = 'OK: 1' THEN 'PASS' ELSE 'FAIL' END);

  -- A non-sitter has NO rank. Without this, `rank` could be a constant 1 and
  -- every claim above it would still pass (G11).
  r := pg_temp.as_user(teacher, format(
        $q$SELECT coalesce(public.rpc_test_student_report(%L,%L) ->> 'rank', 'null')$q$,
        t_id, stu_b));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('...and a student who did not sit it has none','teacher reading a non-sitter','OK: null', r,
     CASE WHEN r = 'OK: null' THEN 'PASS' ELSE 'FAIL' END);
END $probe$;

SELECT area, role_tested, expected, observed, verdict FROM probe ORDER BY n;
ROLLBACK;
