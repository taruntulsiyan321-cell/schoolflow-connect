-- probe24: the school activity feed after 20260911020000, as the caller.
--
-- The policies changed shape from `same_school(school_id)` (a per-row function
-- call) to `school_id IN (SELECT my_accessible_school_ids())` (an indexable
-- set), and gained the §10.20 super-admin branch. The tenancy ANSWER must not
-- move; only its cost, and the one role that was missing.
--
-- THE CLAIMS
--   1. an admin still reads their school's feed.          (positive control)
--   2. a teacher still reads it.                          (positive control)
--   3. a student still reads it (the family policy).      (positive control)
--   4. nobody reads another school's row.
--   5. a super admin with NO grant reads nothing -- and RETURNS, rather than
--      timing out on the exact query shape that produced 57014.   <- THE FIX
--   6. a super admin WITH a live grant reads the feed.    (§10.20)
--   7. ...and still not the other school's row.
--
-- 5 is asserted with `ORDER BY created_at DESC LIMIT 6`, not `count(*)`,
-- because that is the shape that timed out: a count can be answered by a plan
-- that never sorts. An earlier version of this check used count(*), passed,
-- and proved nothing about the failing query.
--
-- Every write is rolled back, including the grant.
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
  sup   uuid := 'd1000005-0001-4000-8000-000000000001';  -- super admin
  adm   uuid := 'd1000001-0001-4000-8000-000000000001';  -- admin, school A
  t1    uuid := 'd1000002-0001-4000-8000-000000000001';  -- teacher, school A
  stu   uuid := 'd1000003-0001-4000-8000-000000000001';  -- student, school A
  sch_a uuid := '00000000-0000-4000-8000-000000000001';
  sch_b uuid := '00000000-0000-4000-8000-000000000002';
  feed_b uuid;
  r     text;
  -- The exact shape the /admin index issues, and the one that returned 57014.
  q_top constant text :=
    'SELECT count(*)::text FROM (SELECT id FROM public.school_activity_feed '
    'ORDER BY created_at DESC LIMIT 6) t';
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.super_admin_access_log l
      JOIN public.super_admins sa ON sa.id = l.super_admin_id
     WHERE sa.account_id = sup AND l.expires_at > now()
  ) THEN
    RAISE EXCEPTION 'probe24: a live grant already exists; claim 5 would be meaningless';
  END IF;

  INSERT INTO public.school_activity_feed (school_id, action)
  VALUES (sch_b, 'probe24.school_b_only')
  RETURNING id INTO feed_b;

  -- ── 1/2/3. the roles that could read, still read ───────────────────────
  r := pg_temp.as_user(adm, q_top);
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('read the school feed (positive control)','admin (school A)','OK: 6', r,
     CASE WHEN r = 'OK: 6' THEN 'PASS' ELSE 'FAIL' END);

  r := pg_temp.as_user(t1, q_top);
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('read the school feed (positive control)','teacher (school A)','OK: 6', r,
     CASE WHEN r = 'OK: 6' THEN 'PASS' ELSE 'FAIL' END);

  r := pg_temp.as_user(stu, q_top);
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('read the school feed via the family policy (positive control)','student (school A)',
     'OK: 6', r, CASE WHEN r = 'OK: 6' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 4. the other school's row stays invisible ──────────────────────────
  r := pg_temp.as_user(adm, format(
        'SELECT count(*)::text FROM public.school_activity_feed WHERE id = %L::uuid', feed_b));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('read another school''s feed row','admin (school A)','OK: 0', r,
     CASE WHEN r = 'OK: 0' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 5. THE FIX: no grant, no rows, no timeout ──────────────────────────
  -- Before 20260911020000 this returned
  --   ERROR: canceling statement due to statement timeout   (57014)
  r := pg_temp.as_user(sup, q_top);
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('top-6 feed query with NO grant -- returns instead of timing out',
     'super_admin','OK: 0, not a 57014 timeout', r,
     CASE WHEN r = 'OK: 0' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 6/7. with the grant, §10.20 read, still fenced ─────────────────────
  r := pg_temp.as_user(sup, format(
        'SELECT public.rpc_super_admin_open_access(%L::uuid, %L, %L, 60)::text',
        sch_a, 'probe24: activity feed', 'caller-privileges verification'));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('open a logged grant for school A','super_admin','OK: a uuid', r,
     CASE WHEN r LIKE 'OK:%' AND length(r) > 12 THEN 'PASS' ELSE 'FAIL' END);

  r := pg_temp.as_user(sup, q_top);
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('read the feed WITH a live grant (positive control, §10.20)','super_admin','OK: 6', r,
     CASE WHEN r = 'OK: 6' THEN 'PASS' ELSE 'FAIL' END);

  r := pg_temp.as_user(sup, format(
        'SELECT count(*)::text FROM public.school_activity_feed WHERE id = %L::uuid', feed_b));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('read a NON-granted school''s feed row','super_admin (granted school A only)',
     'OK: 0', r, CASE WHEN r = 'OK: 0' THEN 'PASS' ELSE 'FAIL' END);
END $probe$;

SELECT area, role_tested, expected, observed, verdict FROM probe ORDER BY n;
ROLLBACK;
