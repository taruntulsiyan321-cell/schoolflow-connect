-- probe13: a second membership must not lock the account out of everything.
--
-- 20260906000000 made `active_membership_id()` fall back to the account's
-- highest-precedence active membership instead of returning NULL whenever the
-- account holds more than one. 111 policies across 68 tables key on it through
-- `has_role/2`, so before that change a teacher who is also a parent at the same
-- school was refused by all of them.
--
-- ── WHAT MAKES THIS PROBE HONEST ─────────────────────────────────────────
--
-- The fixture is BUILT HERE and rolled back: no dual-role account exists in the
-- seed, so a probe that only read existing data would assert nothing.
--
-- Priya's existing `sessions` rows are DELETED first, deliberately. Branches 1
-- and 2 of `active_membership_id()` read `sessions.active_membership_id`; if one
-- of her rows already named her teacher membership, assertion 2 would pass on
-- the session rather than on the precedence fallback under test, and would keep
-- passing with the fix reverted (G11 — a check that cannot fail). Assertion 1b
-- states that no session row exists at that point, so the reader can see which
-- branch is being exercised.
--
-- Switching is then tested SEPARATELY, after a session row exists, to prove the
-- fallback did not swallow an explicit choice.
--
-- ── THE CLAIMS ───────────────────────────────────────────────────────────
--
--   1. Single membership still resolves.                (regression control)
--   2. Two memberships, no session: NOT NULL, and the
--      precedence order picks teacher over parent.      (the fix)
--   3. The non-active role is NOT simultaneously true.  (rule 28 — has_role/2
--      answers "acting in", not "holds")
--   4. TEACHER SURFACE: she can upload to a class she teaches.
--   5. After switching to parent, the same upload is REFUSED.
--                                                       (the surfaces really flip)
--   6. ...and has_role follows the switch, both ways.
--   7. A role she does not hold stays false, in both states.   (negative control)
--   8. The other school stays false.                    (tenancy control)
--
-- Read-only in effect: everything is rolled back.
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
  priya   uuid := 'd1000002-0001-4000-8000-000000000001';  -- teacher, school A
  stud_a  uuid := 'd1000003-0001-4000-8000-000000000001';  -- single-membership student
  cls10   uuid := 'd2000001-0001-4000-8000-000000000001';  -- 10-A, which Priya teaches
  sch_a   uuid := '00000000-0000-4000-8000-000000000001';
  sch_b   uuid := '00000000-0000-4000-8000-000000000002';
  parent_mid uuid;
  n_sessions int;
  n_memb     int;
  r text;
BEGIN
  -- ── 1. Regression control, BEFORE the fixture: one membership still works ──
  r := pg_temp.as_user(stud_a, format('SELECT public.has_role(%L::uuid,''student'')::text', stud_a));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('060000 single membership still resolves (regression control)','student, one membership','OK: true',r,
     CASE WHEN r = 'OK: true' THEN 'PASS' ELSE 'FAIL' END);

  -- ── Build the fixture: Priya becomes teacher AND parent at the same school ──
  DELETE FROM public.sessions WHERE account_id = priya;
  parent_mid := public._grant_membership(priya, sch_a, 'parent'::public.app_role, NULL);

  SELECT count(*) INTO n_memb   FROM public.memberships WHERE account_id = priya AND status = 'active';
  SELECT count(*) INTO n_sessions FROM public.sessions WHERE account_id = priya;

  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('060000 fixture: the account now holds two active memberships','-','OK: 2','OK: '||n_memb,
     CASE WHEN n_memb = 2 THEN 'PASS' ELSE 'FAIL' END);

  -- 1b. States which branch the next assertions exercise. With a session row
  -- present they would test branch 1/2 and would pass with the fix reverted.
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('060000 fixture: no session row, so the fallback is what is under test','-','OK: 0','OK: '||n_sessions,
     CASE WHEN n_sessions = 0 THEN 'PASS' ELSE 'FAIL' END);

  -- ── 2. THE FIX: not NULL, and ordered by the stated precedence ──────────
  r := pg_temp.as_user(priya, 'SELECT (public.active_membership_id() IS NOT NULL)::text');
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('060000 two memberships, no session: active_membership_id is NOT NULL','teacher+parent','OK: true',r,
     CASE WHEN r = 'OK: true' THEN 'PASS' ELSE 'FAIL' END);

  r := pg_temp.as_user(priya, format('SELECT public.has_role(%L::uuid,''teacher'')::text', priya));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('060000 precedence picks teacher over parent','teacher+parent','OK: true',r,
     CASE WHEN r = 'OK: true' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 3. Rule 28: has_role/2 answers "acting in", not "holds" ─────────────
  r := pg_temp.as_user(priya, format('SELECT public.has_role(%L::uuid,''parent'')::text', priya));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('060000 the non-active role is NOT also true','teacher+parent, acting as teacher','OK: false',r,
     CASE WHEN r = 'OK: false' THEN 'PASS' ELSE 'FAIL' END);

  -- The three-arg form disagrees on purpose: she DOES hold parent here.
  r := pg_temp.as_user(priya, format('SELECT public.has_role(%L::uuid,''parent'',%L::uuid)::text', priya, sch_a));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('060000 has_role/3 still says she HOLDS parent (rule 28)','teacher+parent','OK: true',r,
     CASE WHEN r = 'OK: true' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 4. TEACHER SURFACE reached, not merely the predicate ────────────────
  r := pg_temp.as_user(priya, format(
    $q$WITH ins AS (INSERT INTO public.learning_resources
        (school_id, class_id, title, resource_type, storage_path, created_by)
        VALUES (%L,%L,'probe13 dual-role upload','pdf','probe/dual.pdf',%L) RETURNING 1)
      SELECT count(*)::text FROM ins$q$, sch_a, cls10, priya));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('060000 TEACHER SURFACE: dual-role teacher can still upload','teacher+parent, acting as teacher','OK: 1',r,
     CASE WHEN r = 'OK: 1' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 7a. Negative control: a role she does not hold ──────────────────────
  r := pg_temp.as_user(priya, format('SELECT public.has_role(%L::uuid,''admin'')::text', priya));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('060000 a role she does not hold (negative control)','teacher+parent','OK: false',r,
     CASE WHEN r = 'OK: false' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 8. Tenancy control: the other school ────────────────────────────────
  r := pg_temp.as_user(priya, format('SELECT public.has_role(%L::uuid,''teacher'',%L::uuid)::text', priya, sch_b));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('060000 teacher at the OTHER school (tenancy control)','teacher+parent','OK: false',r,
     CASE WHEN r = 'OK: false' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 5/6. Switching must beat the default, and the surfaces must flip ────
  r := pg_temp.as_user(priya, format('SELECT (public.rpc_switch_membership(%L::uuid) IS NOT NULL)::text', parent_mid));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('060000 rpc_switch_membership to the parent membership','teacher+parent','OK: true',r,
     CASE WHEN r = 'OK: true' THEN 'PASS' ELSE 'FAIL' END);

  r := pg_temp.as_user(priya, format('SELECT public.has_role(%L::uuid,''parent'')::text', priya));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('060000 after switching, parent is active','teacher+parent, acting as parent','OK: true',r,
     CASE WHEN r = 'OK: true' THEN 'PASS' ELSE 'FAIL' END);

  r := pg_temp.as_user(priya, format('SELECT public.has_role(%L::uuid,''teacher'')::text', priya));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('060000 the explicit choice BEATS the precedence default','teacher+parent, acting as parent','OK: false',r,
     CASE WHEN r = 'OK: false' THEN 'PASS' ELSE 'FAIL' END);

  -- The surface flips with it. Same statement, same person, refused now.
  r := pg_temp.as_user(priya, format(
    $q$WITH ins AS (INSERT INTO public.learning_resources
        (school_id, class_id, title, resource_type, storage_path, created_by)
        VALUES (%L,%L,'probe13 while acting as parent','pdf','probe/dual2.pdf',%L) RETURNING 1)
      SELECT count(*)::text FROM ins$q$, sch_a, cls10, priya));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('060000 TEACHER SURFACE refused while acting as parent','teacher+parent, acting as parent','ERROR row-level security',r,
     CASE WHEN r LIKE 'ERROR%' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 7b. Negative control repeated in the switched state ─────────────────
  r := pg_temp.as_user(priya, format('SELECT public.has_role(%L::uuid,''admin'')::text', priya));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('060000 still not an admin after switching (negative control)','teacher+parent, acting as parent','OK: false',r,
     CASE WHEN r = 'OK: false' THEN 'PASS' ELSE 'FAIL' END);
END $probe$;

SELECT n, area, role_tested, expected, observed, verdict FROM probe ORDER BY n;
ROLLBACK;
