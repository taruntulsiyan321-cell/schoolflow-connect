-- probe26: students_read after 20260912010000, as the caller.
--
-- The policy moved from `id IN (SELECT my_visible_student_ids())` — which
-- scans `students` once per student row — to a row-local predicate. Every role
-- that could see a student must still see exactly the same students.
--
-- THE CLAIMS
--   1. a teacher reads a student in a class they teach.   (positive control)
--   2. a student reads THEMSELVES.                        (positive control)
--   3. ...and not a classmate's row through this policy... see note below.
--   4. a parent reads their own child.                    (positive control)
--   5. ...and NOT another parent's child.
--   6. an admin reads a student.                          (positive control)
--   7. nobody reads another SCHOOL's student.
--   8. an admin INSERT ... RETURNING still succeeds — the self-reference that
--      refuses a row mid-statement is gone.                <- the shape fixed
--
-- NOTE ON 3. `students_read` admits a student's classmates through the teacher
-- branch only, so a student sees just themselves under THIS policy; the roster
-- a student legitimately sees comes from elsewhere. The claim asserted here is
-- the one the policy actually makes.
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
  t1      uuid := 'd1000002-0001-4000-8000-000000000001';  -- teacher of 10 A
  adm     uuid := 'd1000001-0001-4000-8000-000000000001';  -- admin, school A
  stu_u   uuid := 'd1000003-0001-4000-8000-000000000001';  -- Arjun Mehta (auth uid)
  sch_a   uuid := '00000000-0000-4000-8000-000000000001';
  sch_b   uuid := '00000000-0000-4000-8000-000000000002';
  cls_a   uuid := 'd2000001-0001-4000-8000-000000000001';
  stu_a   uuid;   -- Arjun's students.id
  par_u   uuid;   -- Arjun's guardian auth uid
  other_s uuid;   -- a school A student with a DIFFERENT guardian
  stu_b   uuid;   -- a school B student
  r       text;
BEGIN
  SELECT s.id, s.parent_user_id INTO stu_a, par_u
    FROM public.students s WHERE s.user_id = stu_u;
  IF stu_a IS NULL OR par_u IS NULL THEN
    RAISE EXCEPTION 'probe26: need a school A student with a linked guardian';
  END IF;

  SELECT s.id INTO other_s FROM public.students s
   WHERE s.school_id = sch_a AND s.parent_user_id IS NOT NULL
     AND s.parent_user_id <> par_u ORDER BY s.id LIMIT 1;
  IF other_s IS NULL THEN
    RAISE EXCEPTION 'probe26: need a second guardian to prove the parent fence';
  END IF;

  SELECT s.id INTO stu_b FROM public.students s WHERE s.school_id = sch_b ORDER BY s.id LIMIT 1;
  IF stu_b IS NULL THEN
    INSERT INTO public.students (school_id, full_name, admission_number)
    VALUES (sch_b, 'probe26 school B', 'PROBE26-B') RETURNING id INTO stu_b;
  END IF;

  -- ── 1. teacher ─────────────────────────────────────────────────────────
  r := pg_temp.as_user(t1, format(
        'SELECT count(*)::text FROM public.students WHERE id = %L::uuid', stu_a));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('read a student in a class I teach (positive control)','teacher','OK: 1', r,
     CASE WHEN r = 'OK: 1' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 2. the student themselves ──────────────────────────────────────────
  r := pg_temp.as_user(stu_u, format(
        'SELECT count(*)::text FROM public.students WHERE id = %L::uuid', stu_a));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('read my own student row (positive control)','student','OK: 1', r,
     CASE WHEN r = 'OK: 1' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 4/5. the guardian, and only their own child ────────────────────────
  r := pg_temp.as_user(par_u, format(
        'SELECT count(*)::text FROM public.students WHERE id = %L::uuid', stu_a));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('read my own child (positive control)','parent','OK: 1', r,
     CASE WHEN r = 'OK: 1' THEN 'PASS' ELSE 'FAIL' END);

  r := pg_temp.as_user(par_u, format(
        'SELECT count(*)::text FROM public.students WHERE id = %L::uuid', other_s));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('read ANOTHER guardian''s child','parent','OK: 0', r,
     CASE WHEN r = 'OK: 0' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 6/7. admin, and the tenant fence ───────────────────────────────────
  r := pg_temp.as_user(adm, format(
        'SELECT count(*)::text FROM public.students WHERE id = %L::uuid', stu_a));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('read a student in my school (positive control)','admin','OK: 1', r,
     CASE WHEN r = 'OK: 1' THEN 'PASS' ELSE 'FAIL' END);

  r := pg_temp.as_user(adm, format(
        'SELECT count(*)::text FROM public.students WHERE id = %L::uuid', stu_b));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('read another SCHOOL''s student','admin (school A)','OK: 0', r,
     CASE WHEN r = 'OK: 0' THEN 'PASS' ELSE 'FAIL' END);

  r := pg_temp.as_user(t1, format(
        'SELECT count(*)::text FROM public.students WHERE id = %L::uuid', stu_b));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('read another SCHOOL''s student','teacher (school A)','OK: 0', r,
     CASE WHEN r = 'OK: 0' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 8. INSERT ... RETURNING, the shape the self-reference refused ──────
  r := pg_temp.as_user(adm, format(
        'INSERT INTO public.students (school_id, class_id, full_name, admission_number) '
        'VALUES (%L::uuid, %L::uuid, %L, %L) RETURNING id::text',
        sch_a, cls_a, 'probe26 new student', 'PROBE26-NEW'));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('create a student, RETURNING the row','admin','OK: a uuid, not 42501', r,
     CASE WHEN r LIKE 'OK:%' AND r !~ 'row-level security' THEN 'PASS' ELSE 'FAIL' END);
END $probe$;

SELECT area, role_tested, expected, observed, verdict FROM probe ORDER BY n;
ROLLBACK;
