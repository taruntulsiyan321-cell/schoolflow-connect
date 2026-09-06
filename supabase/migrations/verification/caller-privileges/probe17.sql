-- probe17: the question paper tables, as the caller.
--
-- 20260907010000 created question_papers / _sections / _questions. Unlike
-- question_bank — which §10.9 makes cross-school and which therefore has no
-- school_id — A PAPER IS SCHOOL DATA, so it carries the house RESTRICTIVE
-- tenancy fence plus an owner-or-admin permissive layer, both copied from
-- test_questions.
--
-- THE CLAIMS
--   1. a teacher creates a paper in their OWN school.        (positive control)
--   2. a teacher CANNOT create one in another school.        (tenancy fence)
--   3. the author reads their own paper back.                (positive control)
--   4. another teacher at the same school does NOT see it.
--   5. another teacher CANNOT delete it.
--   6. an admin of the same school DOES see it.              (staff rule)
--   7. a student does NOT see it.
--   8. a question with neither options+index nor answer text is REFUSED —
--      an answerless question cannot be stored at all.
--   9. a well-formed question IS accepted.                   (positive control)
--
-- Everything is rolled back.
BEGIN;
SET LOCAL statement_timeout = '90s';
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
  t1     uuid := 'd1000002-0001-4000-8000-000000000001';  -- teacher, school A
  t2     uuid := 'd1000002-0002-4000-8000-000000000002';  -- 2nd teacher, school A
  adm    uuid := 'd1000001-0001-4000-8000-000000000001';  -- admin, school A
  stu    uuid := 'd1000003-0009-4000-8000-000000000009';  -- student, school A
  sch_a  uuid := '00000000-0000-4000-8000-000000000001';
  sch_b  uuid := '00000000-0000-4000-8000-000000000002';
  paper  uuid;
  sect   uuid;
  r text;
BEGIN
  -- ── 1. own school (positive control) ───────────────────────────────────
  r := pg_temp.as_user(t1, format(
    'WITH i AS (INSERT INTO public.question_papers (school_id, created_by, title, subject, class_level) '
    'VALUES (%L, %L, $x$probe17 paper$x$, $x$Accountancy$x$, 12) RETURNING id) SELECT id::text FROM i', sch_a, t1));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('paper created in OWN school (positive control)','teacher (school A)','OK: a uuid',r,
     CASE WHEN r LIKE 'OK: ________-%' THEN 'PASS' ELSE 'FAIL' END);
  SELECT id INTO paper FROM public.question_papers WHERE title = 'probe17 paper';

  -- ── 2. another school is refused by the RESTRICTIVE fence ──────────────
  r := pg_temp.as_user(t1, format(
    'WITH i AS (INSERT INTO public.question_papers (school_id, created_by, title, subject) '
    'VALUES (%L, %L, $x$probe17 cross-tenant$x$, $x$Accountancy$x$) RETURNING id) SELECT id::text FROM i', sch_b, t1));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('paper created in ANOTHER school','teacher (school A)','ERROR row-level security',
     r || ' / rows: ' || (SELECT count(*) FROM public.question_papers WHERE title='probe17 cross-tenant')::text,
     CASE WHEN r LIKE 'ERROR%row-level security%'
           AND (SELECT count(*) FROM public.question_papers WHERE title='probe17 cross-tenant') = 0
          THEN 'PASS' ELSE 'FAIL' END);

  -- ── 3. author reads it back (positive control) ─────────────────────────
  r := pg_temp.as_user(t1, format('SELECT count(*)::text FROM public.question_papers WHERE id=%L', paper));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('author reads their own paper (positive control)','teacher (school A)','OK: 1',r,
     CASE WHEN r = 'OK: 1' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 4. another teacher does not ────────────────────────────────────────
  r := pg_temp.as_user(t2, format('SELECT count(*)::text FROM public.question_papers WHERE id=%L', paper));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('another teacher reads it','teacher 2 (same school)','OK: 0',r,
     CASE WHEN r = 'OK: 0' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 5. another teacher cannot delete it ────────────────────────────────
  r := pg_temp.as_user(t2, format(
    'WITH d AS (DELETE FROM public.question_papers WHERE id=%L RETURNING 1) SELECT count(*)::text FROM d', paper));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('another teacher deletes it','teacher 2 (same school)','OK: 0 and paper survives',
     r || ' / still there: ' || (SELECT count(*) FROM public.question_papers WHERE id=paper)::text,
     CASE WHEN r = 'OK: 0' AND (SELECT count(*) FROM public.question_papers WHERE id=paper) = 1
          THEN 'PASS' ELSE 'FAIL' END);

  -- ── 6. an admin of the same school does see it ─────────────────────────
  r := pg_temp.as_user(adm, format('SELECT count(*)::text FROM public.question_papers WHERE id=%L', paper));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('admin of the same school reads it (staff rule)','admin (school A)','OK: 1',r,
     CASE WHEN r = 'OK: 1' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 7. a student does not ──────────────────────────────────────────────
  r := pg_temp.as_user(stu, format('SELECT count(*)::text FROM public.question_papers WHERE id=%L', paper));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('a student reads a paper','student (school A)','OK: 0',r,
     CASE WHEN r = 'OK: 0' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 8/9. the answer-shape constraint ───────────────────────────────────
  INSERT INTO public.question_paper_sections
    (paper_id, school_id, order_index, title, question_format, marks_per_question, target_count)
  VALUES (paper, sch_a, 1, 'Section A', 'short', 3, 5) RETURNING id INTO sect;

  r := pg_temp.as_user(t1, format(
    'WITH i AS (INSERT INTO public.question_paper_questions '
    '(paper_id, section_id, school_id, order_index, origin, question) '
    'VALUES (%L, %L, %L, 1, $x$generated$x$, $x$answerless$x$) RETURNING 1) SELECT count(*)::text FROM i',
    paper, sect, sch_a));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('an ANSWERLESS question is stored','teacher (school A)','ERROR qpq_answer_shape',r,
     CASE WHEN r LIKE 'ERROR%qpq_answer_shape%' THEN 'PASS' ELSE 'FAIL' END);

  r := pg_temp.as_user(t1, format(
    'WITH i AS (INSERT INTO public.question_paper_questions '
    '(paper_id, section_id, school_id, order_index, origin, question, answer) '
    'VALUES (%L, %L, %L, 2, $x$generated$x$, $x$a real question$x$, $x$a real answer$x$) RETURNING 1) '
    'SELECT count(*)::text FROM i', paper, sect, sch_a));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('a question WITH an answer is stored (positive control)','teacher (school A)','OK: 1',r,
     CASE WHEN r = 'OK: 1' THEN 'PASS' ELSE 'FAIL' END);
END $probe$;

SELECT area, role_tested, expected, observed, verdict FROM probe ORDER BY n;
ROLLBACK;
