-- probe25: the converted tenant fences, as the caller.
--
-- 20260912000000 rewrote 71 RESTRICTIVE fences from `same_school(school_id)` to
-- `school_id IN (SELECT my_accessible_school_ids())`. That is a PERFORMANCE
-- change to the tenancy choke point of the entire schema, so the thing to prove
-- is that not one row moved.
--
-- THE CLAIMS
--   1. a teacher reads their own school's row.          (positive control)
--   2. ...and NOT school B's row.                        <- the fence
--   3. a student reads their own school's row.          (positive control)
--   4. ...and NOT school B's row.
--   5. an admin reads their own school's row.           (positive control)
--   6. ...and NOT school B's row.
--   7. a WRITE into school B is refused (WITH CHECK, not just USING).
--   8. the query that timed out on academic_audit now RETURNS.  <- the fix
--   9. a school-less caller reads nothing from a converted table.
--
-- The write claim matters on its own: a fence rewritten with USING but not
-- WITH CHECK would pass every read test here and let a row be INSERTED into
-- another tenant. `academic_terms` is used because it is a converted table with a
-- plain id + school_id and a real admin write path.
--
-- These sit on top of the 215 assertions already in this suite, many of which
-- cross tenants on tables this migration touched; a fence that moved would
-- fail there too.
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
  t1    uuid := 'd1000002-0001-4000-8000-000000000001';  -- teacher, school A
  stu   uuid := 'd1000003-0001-4000-8000-000000000001';  -- student, school A
  adm   uuid := 'd1000001-0001-4000-8000-000000000001';  -- admin,   school A
  sup   uuid := 'd1000005-0001-4000-8000-000000000001';  -- super admin, no school
  sch_a uuid := '00000000-0000-4000-8000-000000000001';
  sch_b uuid := '00000000-0000-4000-8000-000000000002';
  row_a uuid;
  row_b uuid;
  r     text;
BEGIN
  -- One row in each school on a CONVERTED table. academic_terms is used
  -- because it has a plain id + school_id, a RESTRICTIVE fence this migration
  -- converted, and an admin-write policy -- so claim 7 exercises WITH CHECK
  -- against a real write path rather than a table nobody may write.
  INSERT INTO public.academic_terms (school_id, name, academic_year, starts_on, ends_on)
  VALUES (sch_a, 'probe25 term A', '2026', current_date, current_date + 30)
  RETURNING id INTO row_a;
  INSERT INTO public.academic_terms (school_id, name, academic_year, starts_on, ends_on)
  VALUES (sch_b, 'probe25 term B', '2026', current_date, current_date + 30)
  RETURNING id INTO row_b;

  -- ── 1-6. reads, each role, both directions ─────────────────────────────
  r := pg_temp.as_user(t1, format(
        'SELECT count(*)::text FROM public.academic_terms WHERE id = %L::uuid', row_a));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('converted fence: read own school (positive control)','teacher (school A)','OK: 1', r,
     CASE WHEN r = 'OK: 1' THEN 'PASS' ELSE 'FAIL' END);

  r := pg_temp.as_user(t1, format(
        'SELECT count(*)::text FROM public.academic_terms WHERE id = %L::uuid', row_b));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('converted fence: read ANOTHER school','teacher (school A)','OK: 0', r,
     CASE WHEN r = 'OK: 0' THEN 'PASS' ELSE 'FAIL' END);

  r := pg_temp.as_user(stu, format(
        'SELECT count(*)::text FROM public.academic_terms WHERE id = %L::uuid', row_a));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('converted fence: read own school (positive control)','student (school A)','OK: 1', r,
     CASE WHEN r = 'OK: 1' THEN 'PASS' ELSE 'FAIL' END);

  r := pg_temp.as_user(stu, format(
        'SELECT count(*)::text FROM public.academic_terms WHERE id = %L::uuid', row_b));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('converted fence: read ANOTHER school','student (school A)','OK: 0', r,
     CASE WHEN r = 'OK: 0' THEN 'PASS' ELSE 'FAIL' END);

  r := pg_temp.as_user(adm, format(
        'SELECT count(*)::text FROM public.academic_terms WHERE id = %L::uuid', row_a));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('converted fence: read own school (positive control)','admin (school A)','OK: 1', r,
     CASE WHEN r = 'OK: 1' THEN 'PASS' ELSE 'FAIL' END);

  r := pg_temp.as_user(adm, format(
        'SELECT count(*)::text FROM public.academic_terms WHERE id = %L::uuid', row_b));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('converted fence: read ANOTHER school','admin (school A)','OK: 0', r,
     CASE WHEN r = 'OK: 0' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 7. WITH CHECK, not only USING ──────────────────────────────────────
  r := pg_temp.as_user(adm, format(
        'WITH i AS (INSERT INTO public.academic_terms '
        '(school_id, name, academic_year, starts_on, ends_on) '
        'VALUES (%L::uuid, ''probe25 cross-tenant'', ''2026'', current_date, current_date + 30) '
        'RETURNING id) SELECT count(*)::text FROM i', sch_b));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('converted fence: WRITE into another school','admin (school A)',
     'ERROR row-level security', r,
     CASE WHEN r LIKE 'ERROR%row-level security%' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 8. the query that timed out ────────────────────────────────────────
  -- Before 20260912000000, as a caller matching nothing, this returned
  --   ERROR: canceling statement due to statement timeout   (57014)
  -- after walking all 9,166 rows.
  r := pg_temp.as_user(sup,
        'SELECT count(*)::text FROM (SELECT id FROM public.academic_audit '
        'ORDER BY created_at DESC LIMIT 6) t');
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('academic_audit top-6 returns instead of timing out','super_admin (no school)',
     'OK: 0, not a 57014 timeout', r,
     CASE WHEN r = 'OK: 0' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 9. ...and a school-less caller still sees nothing ──────────────────
  r := pg_temp.as_user(sup, format(
        'SELECT count(*)::text FROM public.academic_terms WHERE id = %L::uuid', row_a));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('converted fence: school-less caller reads nothing','super_admin (no grant)','OK: 0', r,
     CASE WHEN r = 'OK: 0' THEN 'PASS' ELSE 'FAIL' END);
END $probe$;

SELECT area, role_tested, expected, observed, verdict FROM probe ORDER BY n;
ROLLBACK;
