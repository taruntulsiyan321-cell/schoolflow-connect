-- probe36: the edited-day marker is fenced by school AND by role (§10.19, §10.18).
--
-- `db:verify-integrity` had been reporting `attendance_day_edits` as the only
-- view in `public` that is not `security_invoker`, and nothing had acted on it.
-- Running as its owner means RLS never applies, and measured 2026-09-08 that
-- was not theoretical:
--
--     anon (the browser-bundle key) ... 20 rows, 1 school
--     a student ....................... 20 rows, 1 school
--     the owner (ground truth) ........ 20 rows, 1 school
--
-- Identical. A signed-out visitor saw exactly what the table owner saw.
--
-- It is NOT made security_invoker, deliberately: the view reads
-- `academic_audit`, which §10.18 reserves to admin, so that a PRINCIPAL can
-- still see that a figure moved without being handed the audit log. Flipping
-- the flag would have silently emptied the marker for the people who use it,
-- with every gate still green. So both fences live in the view body instead —
-- `20260914120000` (school + anon) and `20260914130000` (role).
--
-- THE CLAIMS
--   1. the probe sessions are genuinely who they say.      (harness controls)
--   2. anon is REFUSED outright.                                <- the revoke
--   3. a STUDENT sees nothing.                               <- the role fence
--   4. a TEACHER sees nothing either — §10.18 is admin-only, and a teacher is
--      the role most likely to be let in by mistake.
--   5. an ADMIN sees their own school's markers.            (POSITIVE CONTROL)
--   6. ...and cannot see another school's.                  <- the school fence
--   7. the view still carries every column the service reads. (POSITIVE CONTROL)
--
-- 5 and 7 are what make 2, 3 and 4 mean anything: a view returning nothing to
-- anybody, or one that lost `last_edited_by`, satisfies every refusal above
-- while removing the marker from the admin dashboard entirely.
--
-- Every write is rolled back.
BEGIN;
SET LOCAL statement_timeout = '30s';
CREATE TEMP TABLE probe(n serial, area text, role_tested text, expected text, observed text, verdict text) ON COMMIT DROP;

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
  stu     uuid := 'd1000003-0001-4000-8000-000000000001';
  sch_a   uuid := '00000000-0000-4000-8000-000000000001';
  teacher uuid;
  admin_u uuid;
  r       text;
  truth   int;
BEGIN
  SELECT id INTO teacher  FROM auth.users WHERE email = 'priya.sharma@wisdomcampus.com';
  SELECT id INTO admin_u  FROM auth.users WHERE email = 'admin@wisdomcampus.com';
  IF teacher IS NULL OR admin_u IS NULL THEN
    RAISE EXCEPTION 'probe36: demo teacher/admin missing — a skipped check is not a passing check';
  END IF;

  -- Ground truth, read past the fence as the owner would see the base tables.
  SELECT count(*) INTO truth
    FROM public.academic_audit aa
    JOIN public.attendance_submissions s ON s.id = ((aa.metadata ->> 'submission_id'))::uuid
   WHERE aa.entity_type = 'attendance' AND aa.metadata ? 'submission_id'
     AND s.school_id = sch_a;
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('school A has edit rows to be fenced (harness control)','-','> 0', truth::text,
     CASE WHEN truth > 0 THEN 'PASS' ELSE 'FAIL' END);

  -- ── 1. the sessions are real ────────────────────────────────────────────
  r := pg_temp.as_anon('SELECT current_user::text');
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('the anon session really is anon (control)','anon','OK: anon', r,
     CASE WHEN r = 'OK: anon' THEN 'PASS' ELSE 'FAIL' END);

  r := pg_temp.as_user(admin_u, 'SELECT public.get_my_role()::text');
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('the admin session really is admin (control)','admin','OK: admin', r,
     CASE WHEN r = 'OK: admin' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 2. anon ─────────────────────────────────────────────────────────────
  r := pg_temp.as_anon('SELECT count(*)::text FROM public.attendance_day_edits');
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('read the edited-day marker','anon (the browser-bundle key)','ERROR: permission denied', r,
     CASE WHEN r LIKE 'ERROR:%permission denied%' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 3/4. student and teacher ────────────────────────────────────────────
  r := pg_temp.as_user(stu, 'SELECT count(*)::text FROM public.attendance_day_edits');
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('read the marker (was 20 rows before the fence)','student','OK: 0', r,
     CASE WHEN r = 'OK: 0' THEN 'PASS' ELSE 'FAIL' END);

  r := pg_temp.as_user(teacher, 'SELECT count(*)::text FROM public.attendance_day_edits');
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('read the marker — §10.18 is admin only','teacher','OK: 0', r,
     CASE WHEN r = 'OK: 0' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 5. the admin still gets it (POSITIVE CONTROL) ───────────────────────
  r := pg_temp.as_user(admin_u, 'SELECT count(*)::text FROM public.attendance_day_edits');
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('read their own school''s markers (positive control)','admin of school A','OK: > 0', r,
     CASE WHEN r LIKE 'OK: %' AND r <> 'OK: 0' AND r NOT LIKE 'ERROR%' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 6. and only their own school ────────────────────────────────────────
  r := pg_temp.as_user(admin_u,
        'SELECT count(*)::text FROM public.attendance_day_edits WHERE school_id <> '
        || quote_literal(sch_a) || '::uuid');
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('read ANOTHER school''s markers','admin of school A','OK: 0', r,
     CASE WHEN r = 'OK: 0' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 7. the columns the service reads are all still there ────────────────
  INSERT INTO probe(area,role_tested,expected,observed,verdict)
  SELECT 'the view still carries the columns AttendanceService reads','-','5 of 5',
         count(*)::text || ' of 5',
         CASE WHEN count(*) = 5 THEN 'PASS' ELSE 'FAIL' END
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'attendance_day_edits'
     AND column_name IN ('section_id','date','school_id','edit_count','last_edited_by');
END $probe$;

SELECT area, role_tested, expected, observed, verdict FROM probe ORDER BY n;
ROLLBACK;
