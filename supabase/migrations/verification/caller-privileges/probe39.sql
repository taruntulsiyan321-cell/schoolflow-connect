-- probe39: the question paper — who may build one, and does the bank actually
-- fill it (§10, §10.24).
--
-- Written alongside the first UI these three tables have ever had. They were
-- created empty and never used, and measuring them before building found the
-- write side open: as the caller, on 2026-09-09, the PRINCIPAL could create,
-- edit and delete papers (§10 gives them announcements and nothing else) and
-- ANY signed-in user could author one, students included — `question_papers_owner`
-- asked "is this row mine" and never "may this person author a paper at all".
-- Closed by 20260916040000; claims 3-6 hold it closed.
--
-- THE CLAIMS
--   1. the sessions are genuinely who they say.               (harness control)
--   2. a TEACHER builds a paper and a section.                (POSITIVE CONTROL)
--   3. the PRINCIPAL cannot create one.                            <- §10
--   4. a STUDENT cannot create one.                                <- the fence
--   5. a teacher cannot write into another SCHOOL.                 <- tenancy
--   6. anon cannot reach the tables at all.                        <- the grant
--   7. the bank FILLS an MCQ section.                        (POSITIVE CONTROL)
--   8. ...with real options and a real answer key.           (POSITIVE CONTROL)
--   9. ...never the same bank question twice in one paper.         <- the rule
--  10. ...and a second fill adds nothing once the target is met.
--  11. a 'short' section is refused, and says why.                 <- the bank
--  12. another teacher cannot fill MY section.                     <- the fence
--  13. an all-MCQ paper becomes a test, keyed by POSITION.   (POSITIVE CONTROL)
--  14. a paper with one free-text answer is refused.              <- §10.24
--
-- 2, 7, 8 and 13 are what make the refusals mean anything: a paper feature
-- that refuses everybody satisfies every denial here and does nothing.
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
  sch_b     uuid := '00000000-0000-4000-8000-000000000002';
  cls10     uuid := 'd2000001-0001-4000-8000-000000000001';
  teacher   uuid;   -- Priya, teaches 10-A
  other_t   uuid;   -- a second school-A teacher
  principal uuid;
  student   uuid;
  ss        uuid;
  bank_subj text;
  bank_chap text;
  paper     uuid;
  sec_mcq   uuid;
  sec_short uuid;
  r         text;
BEGIN
  SELECT id INTO teacher   FROM auth.users WHERE email='priya.sharma@wisdomcampus.com';
  SELECT id INTO principal FROM auth.users WHERE email='principal@wisdomcampus.com';
  SELECT t.user_id INTO other_t FROM public.teachers t
   WHERE t.school_id=sch_a AND t.user_id IS NOT NULL AND t.user_id <> teacher LIMIT 1;
  SELECT s.user_id INTO student FROM public.students s
   WHERE s.school_id=sch_a AND s.user_id IS NOT NULL ORDER BY s.id LIMIT 1;
  SELECT s.id INTO ss FROM public.section_subjects s
   WHERE s.section_id=cls10 AND s.school_id=sch_a LIMIT 1;

  -- A subject/chapter pair the bank can actually answer for class 10. Chosen
  -- FROM THE BANK, not assumed: a fixture picked by guessing a subject name is
  -- how a fill test passes as "0 inserted, no error".
  SELECT qb.subject, qb.chapter INTO bank_subj, bank_chap
    FROM public.question_bank qb
   WHERE qb.is_active AND qb.is_approved AND qb.class_level = 10
     AND qb.difficulty = 'medium'
   GROUP BY qb.subject, qb.chapter
  HAVING count(*) >= 3
   ORDER BY count(*) DESC
   LIMIT 1;

  IF teacher IS NULL OR principal IS NULL OR other_t IS NULL OR student IS NULL
     OR ss IS NULL OR bank_subj IS NULL THEN
    RAISE EXCEPTION
      'probe39: fixtures missing (teacher=%, principal=%, other_teacher=%, student=%, '
      'section_subject=%, bank_subject=%) — a skipped check is not a passing check',
      teacher, principal, other_t, student, ss, bank_subj;
  END IF;

  -- ── 1. the sessions are real ────────────────────────────────────────────
  r := pg_temp.as_user(teacher, 'SELECT public.get_my_role()::text');
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('the teacher session really is a teacher (control)','teacher','OK: teacher', r,
     CASE WHEN r = 'OK: teacher' THEN 'PASS' ELSE 'FAIL' END);

  r := pg_temp.as_user(teacher, 'SELECT public.can_author_question_paper()::text');
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('...and may author papers (control)','teacher','OK: true', r,
     CASE WHEN r = 'OK: true' THEN 'PASS' ELSE 'FAIL' END);

  r := pg_temp.as_user(principal, 'SELECT public.can_author_question_paper()::text');
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('...while the principal may not','principal','OK: false', r,
     CASE WHEN r = 'OK: false' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 2. the teacher builds a paper (POSITIVE CONTROL) ───────────────────
  r := pg_temp.as_user(teacher, format(
        $q$INSERT INTO public.question_papers
             (school_id, created_by, title, subject, class_level, board, duration_minutes)
           VALUES (%L, %L, 'probe39 paper', %L, 10, NULL, 60) RETURNING id::text$q$,
        sch_a, teacher, bank_subj));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('a teacher creates a question paper (positive control)','teacher','OK: <uuid>', r,
     CASE WHEN r LIKE 'OK: ________-%' THEN 'PASS' ELSE 'FAIL' END);

  SELECT id INTO paper FROM public.question_papers
   WHERE title='probe39 paper' AND created_by=teacher LIMIT 1;
  IF paper IS NULL THEN
    RAISE EXCEPTION 'probe39: the teacher could not create a paper — every claim below would pass vacuously';
  END IF;

  r := pg_temp.as_user(teacher, format(
        $q$INSERT INTO public.question_paper_sections
             (paper_id, school_id, order_index, title, question_format,
              marks_per_question, target_count, difficulty, chapters)
           VALUES (%L, %L, 0, 'Section A', 'mcq', 1, 3, 'medium', ARRAY[%L]::text[])
           RETURNING id::text$q$, paper, sch_a, bank_chap));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('...and a section on it (positive control)','teacher','OK: <uuid>', r,
     CASE WHEN r LIKE 'OK: ________-%' THEN 'PASS' ELSE 'FAIL' END);

  SELECT id INTO sec_mcq FROM public.question_paper_sections
   WHERE paper_id=paper AND question_format='mcq' LIMIT 1;

  -- ── 3/4/5/6. the refusals ──────────────────────────────────────────────
  r := pg_temp.as_user(principal, format(
        $q$INSERT INTO public.question_papers (school_id, created_by, title, subject, class_level)
           VALUES (%L, %L, 'probe39 principal', 'Science', 10) RETURNING 'inserted'$q$, sch_a, principal));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('creating a question paper','principal (§10: announcements only)','ERROR: violates row-level security', r,
     CASE WHEN r LIKE 'ERROR:%row-level security%' THEN 'PASS' ELSE 'FAIL' END);

  r := pg_temp.as_user(student, format(
        $q$INSERT INTO public.question_papers (school_id, created_by, title, subject, class_level)
           VALUES (%L, %L, 'probe39 student', 'Science', 10) RETURNING 'inserted'$q$, sch_a, student));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('creating a question paper','student','ERROR: violates row-level security', r,
     CASE WHEN r LIKE 'ERROR:%row-level security%' THEN 'PASS' ELSE 'FAIL' END);

  r := pg_temp.as_user(teacher, format(
        $q$INSERT INTO public.question_papers (school_id, created_by, title, subject, class_level)
           VALUES (%L, %L, 'probe39 cross', 'Science', 10) RETURNING 'inserted'$q$, sch_b, teacher));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('creating a paper in ANOTHER school','teacher of school A','ERROR: tenant_fence', r,
     CASE WHEN r LIKE 'ERROR:%tenant_fence%' THEN 'PASS' ELSE 'FAIL' END);

  r := pg_temp.as_anon('SELECT count(*)::text FROM public.question_papers');
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('reading the paper tables','anon (the browser-bundle key)','ERROR: permission denied', r,
     CASE WHEN r LIKE 'ERROR:%permission denied%' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 7/8. THE BANK ACTUALLY FILLS IT ────────────────────────────────────
  r := pg_temp.as_user(teacher, format(
        $q$SELECT (public.rpc_fill_paper_section_from_bank(%L) ->> 'inserted')$q$, sec_mcq));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('the bank fills an MCQ section (positive control)','teacher','OK: 3', r,
     CASE WHEN r = 'OK: 3' THEN 'PASS' ELSE 'FAIL' END);

  r := pg_temp.as_user(teacher, format(
        $q$SELECT count(*)::text FROM public.question_paper_questions q
            WHERE q.section_id = %L
              AND q.origin = 'retrieved' AND q.bank_id IS NOT NULL
              AND q.options IS NOT NULL AND q.correct_index IS NOT NULL$q$, sec_mcq));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('...every row carries options and an answer key (positive control)','teacher','OK: 3', r,
     CASE WHEN r = 'OK: 3' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 9. no duplicate bank question inside one paper ─────────────────────
  r := pg_temp.as_user(teacher, format(
        $q$SELECT (count(*) = count(DISTINCT bank_id))::text
             FROM public.question_paper_questions WHERE paper_id = %L$q$, paper));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('...and no bank question appears twice in the paper','teacher','OK: true', r,
     CASE WHEN r = 'OK: true' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 10. filling again adds nothing once the target is met ──────────────
  r := pg_temp.as_user(teacher, format(
        $q$SELECT (public.rpc_fill_paper_section_from_bank(%L) ->> 'inserted')$q$, sec_mcq));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('...a second fill adds nothing once target_count is met','teacher','OK: 0', r,
     CASE WHEN r = 'OK: 0' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 11. a short-answer section, and the reason ─────────────────────────
  r := pg_temp.as_user(teacher, format(
        $q$INSERT INTO public.question_paper_sections
             (paper_id, school_id, order_index, title, question_format,
              marks_per_question, target_count, difficulty, chapters)
           VALUES (%L, %L, 1, 'Section B', 'short', 3, 2, NULL, ARRAY[]::text[])
           RETURNING id::text$q$, paper, sch_a));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('...a short-answer section is created (positive control)','teacher','OK: <uuid>', r,
     CASE WHEN r LIKE 'OK: ________-%' THEN 'PASS' ELSE 'FAIL' END);

  SELECT id INTO sec_short FROM public.question_paper_sections
   WHERE paper_id=paper AND question_format='short' LIMIT 1;

  r := pg_temp.as_user(teacher, format(
        $q$SELECT (public.rpc_fill_paper_section_from_bank(%L) ->> 'inserted')$q$, sec_short));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('...and the bank refuses it, naming multiple-choice','teacher','ERROR: multiple-choice questions only', r,
     CASE WHEN r LIKE 'ERROR:%multiple-choice questions only%' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 12. another teacher's section ──────────────────────────────────────
  r := pg_temp.as_user(other_t, format(
        $q$SELECT (public.rpc_fill_paper_section_from_bank(%L) ->> 'inserted')$q$, sec_mcq));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('filling a section on somebody else''s paper','another teacher in the same school','ERROR: Not your question paper', r,
     CASE WHEN r LIKE 'ERROR:%Not your question paper%' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 13. an all-MCQ paper becomes a test ────────────────────────────────
  --
  -- Section B exists but is empty, so at this point every QUESTION in the
  -- paper is an MCQ even though a non-MCQ section heading is present. That is
  -- the distinction §10.24 turns on and it is deliberately exercised here.
  r := pg_temp.as_user(teacher, format(
        $q$SELECT public.rpc_question_paper_to_test(%L, %L, 600)::text$q$, paper, ss));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('an all-MCQ paper is pushed as an online test (positive control)','teacher of 10-A','OK: <uuid>', r,
     CASE WHEN r LIKE 'OK: ________-%' THEN 'PASS' ELSE 'FAIL' END);

  r := pg_temp.as_user(teacher, format(
        $q$SELECT count(*)::text FROM public.test_questions tq
            JOIN public.tests t ON t.id = tq.test_id
           WHERE t.title = 'probe39 paper'
             AND tq.question_format = 'mcq'
             AND tq.correct ? 'indexes'$q$));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('...and every answer key is a POSITION, not a label','teacher','OK: 3', r,
     CASE WHEN r = 'OK: 3' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 14. one free-text answer, and the push is refused ──────────────────
  r := pg_temp.as_user(teacher, format(
        $q$INSERT INTO public.question_paper_questions
             (paper_id, section_id, school_id, order_index, origin, question, answer, marks)
           VALUES (%L, %L, %L, 0, 'generated', 'Explain ionic bonding.',
                   'Electrons transfer between atoms.', 3)
           RETURNING 'inserted'$q$, paper, sec_short, sch_a));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('...a free-text question is added to the paper (positive control)','teacher','OK: inserted', r,
     CASE WHEN r = 'OK: inserted' THEN 'PASS' ELSE 'FAIL' END);

  r := pg_temp.as_user(teacher, format(
        $q$SELECT public.rpc_question_paper_to_test(%L, %L, 600)::text$q$, paper, ss));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('...and the SAME paper can no longer be pushed as a test (§10.24)','teacher','ERROR: Only an all-MCQ paper', r,
     CASE WHEN r LIKE 'ERROR:%Only an all-MCQ paper%' THEN 'PASS' ELSE 'FAIL' END);
END $probe$;

SELECT area, role_tested, expected, observed, verdict FROM probe ORDER BY n;
ROLLBACK;
