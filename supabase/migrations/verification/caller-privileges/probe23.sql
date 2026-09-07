-- probe23: same_school() after 20260911010000, as the caller.
--
-- The rewrite is a PERFORMANCE fix that must not move a single row-level
-- answer. NULL and false both exclude a row, so the risk is not that it starts
-- refusing people — it is that a fold introduced to make it cheap quietly
-- admits or refuses someone it should not.
--
-- THE CLAIMS
--   1. a teacher matches their OWN school.                (positive control)
--   2. ...and does not match another school.
--   3. a school-less caller gets FALSE, not NULL -- the fold that removes the
--      full scan.                                          <- THE FIX
--   4. a super admin with NO grant does not match a school.
--   5. a super admin WITH a grant matches the granted school.
--   6. ...and still does not match a school they were not granted.
--   7. NULL school_id never matches, for anyone.
--   8. the feed read that timed out (57014) now completes for the super admin.
--
-- 1, 5 and 8 would catch a fold that broke access; 2, 4, 6 and 7 would catch
-- one that opened it. 3 is the fix itself, and it is asserted as `false` rather
-- than "not true", because NULL was the old answer and NULL is what was slow.
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
  sup   uuid := 'd1000005-0001-4000-8000-000000000001';  -- super admin, no membership
  t1    uuid := 'd1000002-0001-4000-8000-000000000001';  -- teacher, school A
  sch_a uuid := '00000000-0000-4000-8000-000000000001';
  sch_b uuid := '00000000-0000-4000-8000-000000000002';
  r     text;
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.super_admin_access_log l
      JOIN public.super_admins sa ON sa.id = l.super_admin_id
     WHERE sa.account_id = sup AND l.expires_at > now()
  ) THEN
    RAISE EXCEPTION 'probe23: a live grant already exists; the no-grant claims would be meaningless';
  END IF;

  -- ── 1/2. the ordinary caller ───────────────────────────────────────────
  r := pg_temp.as_user(t1, format('SELECT public.same_school(%L::uuid)::text', sch_a));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('same_school on my own school (positive control)','teacher (school A)','OK: true', r,
     CASE WHEN r = 'OK: true' THEN 'PASS' ELSE 'FAIL' END);

  r := pg_temp.as_user(t1, format('SELECT public.same_school(%L::uuid)::text', sch_b));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('same_school on another school','teacher (school A)','OK: false', r,
     CASE WHEN r = 'OK: false' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 3/4. the school-less caller: FALSE, not NULL ───────────────────────
  -- The super admin has no membership and, since 20260911000000, no profile
  -- route either, so this is the school-less case.
  r := pg_temp.as_user(sup, format('SELECT public.same_school(%L::uuid)::text', sch_a));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('same_school with no school and no grant -- must be false, not null',
     'super_admin','OK: false', r,
     CASE WHEN r = 'OK: false' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 8. and the read that timed out now completes ───────────────────────
  -- Asserted as "returns a count without erroring". A 57014 arrives here as
  -- ERROR: canceling statement due to statement timeout.
  r := pg_temp.as_user(sup,
        'SELECT count(*)::text FROM public.school_activity_feed');
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('read the feed that returned 57014 (timeout)','super_admin (no grant)',
     'OK: 0, not a timeout', r,
     CASE WHEN r = 'OK: 0' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 5/6. the granted super admin ───────────────────────────────────────
  r := pg_temp.as_user(sup, format(
        'SELECT public.rpc_super_admin_open_access(%L::uuid, %L, %L, 60)::text',
        sch_a, 'probe23: same_school', 'caller-privileges verification'));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('open a logged grant for school A','super_admin','OK: a uuid', r,
     CASE WHEN r LIKE 'OK:%' AND length(r) > 12 THEN 'PASS' ELSE 'FAIL' END);

  r := pg_temp.as_user(sup, format('SELECT public.same_school(%L::uuid)::text', sch_a));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('same_school on the GRANTED school (positive control)','super_admin','OK: true', r,
     CASE WHEN r = 'OK: true' THEN 'PASS' ELSE 'FAIL' END);

  r := pg_temp.as_user(sup, format('SELECT public.same_school(%L::uuid)::text', sch_b));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('same_school on a school NOT granted','super_admin (granted school A only)',
     'OK: false', r,
     CASE WHEN r = 'OK: false' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 7. NULL is nobody's school ─────────────────────────────────────────
  r := pg_temp.as_user(t1, 'SELECT public.same_school(NULL::uuid)::text');
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('same_school(NULL) never matches','teacher','OK: false', r,
     CASE WHEN r = 'OK: false' THEN 'PASS' ELSE 'FAIL' END);
END $probe$;

SELECT area, role_tested, expected, observed, verdict FROM probe ORDER BY n;
ROLLBACK;
