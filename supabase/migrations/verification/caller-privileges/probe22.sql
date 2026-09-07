-- probe22: the super admin's only way into a school is a grant.
--
-- §10.20 (docs/locked-decisions.md:611-634): "Unrestricted access to academic
-- data, for support", but "THE ACCESS-LOG ROW IS THE GRANT. Unlogged super
-- admin access is not expressible in the schema -- there is no path to data
-- without a log entry."
--
-- Before 20260911000000 there was such a path. `get_my_school_id()` ends in a
-- `profiles.school_id` fallback for accounts holding no membership and no local
-- person row; a super admin is exactly that, and the seeded one carries school
-- A on its profile. So it reached school A with 0 grants and 0 log rows.
--
-- THE CLAIMS
--   1. with NO grant, get_my_school_id() is NULL for the super admin.  <- fix
--   2. ...so my_accessible_school_ids() is empty for them.
--   3. ...and they read ZERO exams.
--   4. opening a grant returns the log row's id -- the row IS the grant.
--   5. with the grant, my_accessible_school_ids() contains that school.
--   6. ...and they read exams.                            (positive control)
--   7. get_my_school_id() is STILL NULL even WITH the grant -- access arrives
--      through the logged branch, never through the profile. This is what
--      distinguishes the fix from simply handing them the school again.
--   8. a teacher's own school still resolves.              (positive control)
--   9. ...and the teacher still reads their class's exams. (positive control)
--
-- 8 and 9 are what would catch a change that closed the hole by breaking
-- get_my_school_id() for everybody. 3 and 6 are the two halves that make the
-- grant meaningful rather than decorative.
--
-- Every write is rolled back, including the grant.
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
  sup    uuid := 'd1000005-0001-4000-8000-000000000001';  -- superadmin@wisdomcampus.com
  t1     uuid := 'd1000002-0001-4000-8000-000000000001';  -- Priya Sharma, teacher, school A
  sch_a  uuid := '00000000-0000-4000-8000-000000000001';
  cls    uuid := 'd2000001-0001-4000-8000-000000000001';
  ex_id  uuid;
  r      text;
BEGIN
  -- Something for them to read or not read. Created as postgres so its
  -- existence is not itself what is under test.
  INSERT INTO public.exams (school_id, class_id, name, exam_type, exam_date, max_marks, status)
  VALUES (sch_a, cls, 'probe22 sitting', 'unit_test', current_date, 100, 'scheduled')
  RETURNING id INTO ex_id;

  -- Guard the fixture: if a live grant already existed, claims 1-3 would be
  -- testing the granted state and would pass for the wrong reason.
  IF EXISTS (
    SELECT 1 FROM public.super_admin_access_log l
      JOIN public.super_admins sa ON sa.id = l.super_admin_id
     WHERE sa.account_id = sup AND l.expires_at > now()
  ) THEN
    RAISE EXCEPTION 'probe22: a live grant already exists; the no-grant claims would be meaningless';
  END IF;

  -- ── 1/2/3. no grant, no school, no data ────────────────────────────────
  r := pg_temp.as_user(sup, 'SELECT coalesce(public.get_my_school_id()::text, ''NULL'')');
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('own school with NO access grant','super_admin','OK: NULL', r,
     CASE WHEN r = 'OK: NULL' THEN 'PASS' ELSE 'FAIL' END);

  r := pg_temp.as_user(sup,
        'SELECT count(*)::text FROM (SELECT public.my_accessible_school_ids()) q');
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('accessible schools with NO grant','super_admin','OK: 0', r,
     CASE WHEN r = 'OK: 0' THEN 'PASS' ELSE 'FAIL' END);

  r := pg_temp.as_user(sup, format(
        'SELECT count(*)::text FROM public.exams WHERE id = %L::uuid', ex_id));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('read a school exam with NO grant','super_admin','OK: 0', r,
     CASE WHEN r = 'OK: 0' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 4. the grant is a logged row, and the RPC hands back its id ────────
  r := pg_temp.as_user(sup, format(
        'SELECT public.rpc_super_admin_open_access(%L::uuid, %L, %L, 60)::text',
        sch_a, 'probe22: exams read', 'caller-privileges verification'));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('open a logged access grant','super_admin','OK: a uuid', r,
     CASE WHEN r LIKE 'OK:%' AND r !~ 'ERROR' AND length(r) > 12 THEN 'PASS' ELSE 'FAIL' END);

  -- ── 5/6. with the grant, the school and its data appear ────────────────
  r := pg_temp.as_user(sup, format(
        'SELECT count(*)::text FROM (SELECT public.my_accessible_school_ids() AS s) q WHERE q.s = %L::uuid',
        sch_a));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('the granted school is now accessible (positive control)','super_admin','OK: 1', r,
     CASE WHEN r = 'OK: 1' THEN 'PASS' ELSE 'FAIL' END);

  r := pg_temp.as_user(sup, format(
        'SELECT count(*)::text FROM public.exams WHERE id = %L::uuid', ex_id));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('read a school exam WITH the grant (positive control)','super_admin','OK: 1', r,
     CASE WHEN r = 'OK: 1' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 7. the profile is still not a route ────────────────────────────────
  r := pg_temp.as_user(sup, 'SELECT coalesce(public.get_my_school_id()::text, ''NULL'')');
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('own school even WITH a grant (must stay NULL)','super_admin','OK: NULL', r,
     CASE WHEN r = 'OK: NULL' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 8/9. ordinary accounts are untouched ───────────────────────────────
  r := pg_temp.as_user(t1, 'SELECT coalesce(public.get_my_school_id()::text, ''NULL'')');
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('own school still resolves (positive control)','teacher', 'OK: ' || sch_a::text, r,
     CASE WHEN r = 'OK: ' || sch_a::text THEN 'PASS' ELSE 'FAIL' END);

  r := pg_temp.as_user(t1, format(
        'SELECT count(*)::text FROM public.exams WHERE id = %L::uuid', ex_id));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('teacher still reads their class''s exam (positive control)','teacher','OK: 1', r,
     CASE WHEN r = 'OK: 1' THEN 'PASS' ELSE 'FAIL' END);
END $probe$;

SELECT area, role_tested, expected, observed, verdict FROM probe ORDER BY n;
ROLLBACK;
