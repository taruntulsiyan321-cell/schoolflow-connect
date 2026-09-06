-- probe19: exams_read is row-local, as the caller.
--
-- 20260909000000 replaced a self-referential SELECT policy on public.exams.
-- The old one asked `id IN (SELECT my_visible_exam_ids())`, and that function
-- selects from public.exams itself. A STABLE function sees the statement's
-- snapshot, so during INSERT ... RETURNING the row being inserted is not in
-- it, and PostgreSQL refused every such insert with 42501. PostgREST sends
-- `Prefer: return=representation` for `.insert(...).select()`, so no teacher
-- could create an exam through the app, ever.
--
-- THE CLAIMS
--   1. the class teacher can INSERT ... RETURNING an exam for a class they
--      teach.                                          <- THE FIX. 42501 before.
--   2. the class teacher can still READ an exam of a class they teach.
--                                                      (positive control)
--   3. a teacher CANNOT read an exam of a class in their own school that they
--      do not teach.
--   4. a teacher CANNOT read another SCHOOL's exam.
--   5. a teacher CANNOT insert an exam for a class they do not teach -- the
--      WITH CHECK on exams_insert is untouched by this migration.
--   6. a student CAN read an exam of their own class.  (positive control)
--   7. a student CANNOT read an exam of another class.
--
-- 1, 2 and 6 are what would catch a "fix" that simply closed the table.
-- 3, 4, 5 and 7 are what would catch a fix that opened it.
--
-- Every write is rolled back.
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
  t1       uuid := 'd1000002-0001-4000-8000-000000000001';  -- Priya Sharma, teacher, school A
  stu_a    uuid := 'd1000003-0001-4000-8000-000000000001';  -- Arjun Mehta, student in 10 A
  sch_a    uuid := '00000000-0000-4000-8000-000000000001';
  sch_b    uuid := '00000000-0000-4000-8000-000000000002';
  cls_taught uuid := 'd2000001-0001-4000-8000-000000000001'; -- 10 A, Priya is class teacher
  cls_other  uuid;   -- a school A class Priya does not teach
  cls_b      uuid;   -- a school B class
  ex_taught  uuid;   -- exam in 10 A
  ex_other   uuid;   -- exam in the untaught school A class
  ex_b       uuid;   -- exam in school B
  r text;
BEGIN
  -- ── fixtures ───────────────────────────────────────────────────────────
  -- Priya is mapped to every existing class in school A, so the "same school,
  -- not mine" case needs a class that exists only for this probe.
  INSERT INTO public.classes (school_id, name, section, academic_year)
  VALUES (sch_a, 'probe19 untaught', 'Z', to_char(now(),'YYYY'))
  RETURNING id INTO cls_other;

  SELECT id INTO cls_b FROM public.classes WHERE school_id = sch_b ORDER BY id LIMIT 1;
  IF cls_b IS NULL THEN
    RAISE EXCEPTION 'probe19: need a class in school B for the cross-tenant claim';
  END IF;

  INSERT INTO public.exams (school_id, class_id, name, exam_type, exam_date, max_marks, status)
  VALUES (sch_a, cls_taught, 'probe19 mine', 'unit_test', current_date, 100, 'scheduled')
  RETURNING id INTO ex_taught;
  INSERT INTO public.exams (school_id, class_id, name, exam_type, exam_date, max_marks, status)
  VALUES (sch_a, cls_other, 'probe19 not mine', 'unit_test', current_date, 100, 'scheduled')
  RETURNING id INTO ex_other;
  INSERT INTO public.exams (school_id, class_id, name, exam_type, exam_date, max_marks, status)
  VALUES (sch_b, cls_b, 'probe19 other school', 'unit_test', current_date, 100, 'scheduled')
  RETURNING id INTO ex_b;

  -- ── 1. THE FIX: INSERT ... RETURNING, which is what PostgREST issues ────
  -- Before 20260909000000 this was
  --   ERROR: new row violates row-level security policy for table "exams"
  r := pg_temp.as_user(t1, format(
        'INSERT INTO public.exams (school_id, class_id, name, exam_type, exam_date, max_marks, status) '
        'VALUES (%L::uuid, %L::uuid, %L, %L::exam_type, current_date, 100, %L) RETURNING id::text',
        sch_a, cls_taught, 'probe19 created by the teacher', 'unit_test', 'scheduled'));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('create an exam for a class I teach, RETURNING the row','teacher (class teacher of 10 A)',
     'OK: a uuid, not 42501', r,
     CASE WHEN r LIKE 'OK:%' AND r !~ 'row-level security' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 2. reading an exam of a class I teach (positive control) ───────────
  r := pg_temp.as_user(t1, format(
        'SELECT count(*)::text FROM public.exams WHERE id = %L::uuid', ex_taught));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('read an exam of a class I teach (positive control)','teacher','OK: 1', r,
     CASE WHEN r = 'OK: 1' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 3. same school, a class I do not teach ─────────────────────────────
  r := pg_temp.as_user(t1, format(
        'SELECT count(*)::text FROM public.exams WHERE id = %L::uuid', ex_other));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('read an exam of a class I do NOT teach (same school)','teacher','OK: 0', r,
     CASE WHEN r = 'OK: 0' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 4. another school ──────────────────────────────────────────────────
  r := pg_temp.as_user(t1, format(
        'SELECT count(*)::text FROM public.exams WHERE id = %L::uuid', ex_b));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('read another school''s exam','teacher (school A)','OK: 0', r,
     CASE WHEN r = 'OK: 0' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 5. the WITH CHECK still bites ──────────────────────────────────────
  r := pg_temp.as_user(t1, format(
        'INSERT INTO public.exams (school_id, class_id, name, exam_type, exam_date, max_marks, status) '
        'VALUES (%L::uuid, %L::uuid, %L, %L::exam_type, current_date, 100, %L) RETURNING id::text',
        sch_a, cls_other, 'probe19 should be refused', 'unit_test', 'scheduled'));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('create an exam for a class I do NOT teach','teacher',
     'ERROR row-level security', r,
     CASE WHEN r LIKE 'ERROR%row-level security%' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 6/7. the student's own class, and not another ──────────────────────
  r := pg_temp.as_user(stu_a, format(
        'SELECT count(*)::text FROM public.exams WHERE id = %L::uuid', ex_taught));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('read an exam of my own class (positive control)','student of 10 A','OK: 1', r,
     CASE WHEN r = 'OK: 1' THEN 'PASS' ELSE 'FAIL' END);

  r := pg_temp.as_user(stu_a, format(
        'SELECT count(*)::text FROM public.exams WHERE id = %L::uuid', ex_other));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('read an exam of a class I am not in','student of 10 A','OK: 0', r,
     CASE WHEN r = 'OK: 0' THEN 'PASS' ELSE 'FAIL' END);
END $probe$;

SELECT area, role_tested, expected, observed, verdict FROM probe ORDER BY n;
ROLLBACK;
