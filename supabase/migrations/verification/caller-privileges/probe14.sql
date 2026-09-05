-- probe14: the four rewritten account RPCs, as the caller.
--
-- 20260906020000 moved four SECURITY DEFINER functions off `user_roles` onto
-- `_grant_membership` / `_revoke_membership`, and gave each the `same_school`
-- fence it never had. Before it they updated `teachers` / `students` BY ID with
-- no institution check at all.
--
-- Every denial is paired with a positive control, because a fence that simply
-- broke the feature would pass a refusal-only test (rule 8). Every write is
-- rolled back.
--
-- THE CLAIMS
--   1. admin of school A is REFUSED on a school B teacher, for all three
--      teacher RPCs.                                      (the new fence)
--   2. the same admin still works on their OWN school.     (positive control)
--   3. revoking actually revokes the MEMBERSHIP, not a user_roles row.
--   4. deactivating revokes it; reactivating grants it back.
--   5. a teacher calling an admin RPC is refused.          (role gate intact)
--   6. the dropped functions are gone...
--   7. ...and the three-argument connect that does the real work survives.
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
  admin_a  uuid := 'd1000001-0001-4000-8000-000000000001';  -- admin of school A
  teach_a  uuid := 'd1000002-0001-4000-8000-000000000001';  -- a teacher, school A
  trow_a   uuid := 'd3000002-0002-4000-8000-000000000002';  -- teachers row, school A
  tuser_a  uuid := 'd1000002-0002-4000-8000-000000000002';  -- that row's account
  trow_b   uuid := 'e12b302e-3f50-591f-96b8-a5421c7a6883';  -- teachers row, school B
  srow_b   uuid;
  sch_a    uuid := '00000000-0000-4000-8000-000000000001';
  r text; n int;
BEGIN
  SELECT id INTO srow_b FROM public.students
   WHERE school_id = '00000000-0000-4000-8000-000000000002' AND user_id IS NOT NULL LIMIT 1;

  -- ── 1. THE FENCE: school A admin reaching into school B ────────────────
  r := pg_temp.as_user(admin_a, format('SELECT public.admin_revoke_teacher_account(%L::uuid)::text', trow_b));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('060002 revoke teacher CROSS-TENANT','admin of school A','ERROR outside your school',r,
     CASE WHEN r LIKE 'ERROR%outside your school%' THEN 'PASS' ELSE 'FAIL' END);

  r := pg_temp.as_user(admin_a, format('SELECT public.admin_set_teacher_access(%L::uuid, false)::text', trow_b));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('060002 set teacher access CROSS-TENANT','admin of school A','ERROR outside your school',r,
     CASE WHEN r LIKE 'ERROR%outside your school%' THEN 'PASS' ELSE 'FAIL' END);

  r := pg_temp.as_user(admin_a, format('SELECT public.admin_connect_teacher_account(%L::uuid, %L)::text', trow_b, 'probe14@northfield.test'));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('060002 connect teacher CROSS-TENANT','admin of school A','ERROR outside your school',r,
     CASE WHEN r LIKE 'ERROR%outside your school%' THEN 'PASS' ELSE 'FAIL' END);

  IF srow_b IS NOT NULL THEN
    r := pg_temp.as_user(admin_a, format('SELECT public.admin_revoke_student_account(%L::uuid)::text', srow_b));
    INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
      ('060002 revoke student CROSS-TENANT','admin of school A','ERROR outside your school',r,
       CASE WHEN r LIKE 'ERROR%outside your school%' THEN 'PASS' ELSE 'FAIL' END);
  ELSE
    INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
      ('060002 revoke student CROSS-TENANT','admin of school A','a linked school B student to test with',
       'ERROR: no fixture', 'FAIL');
  END IF;

  -- ── 5. Role gate: a teacher is not an admin ────────────────────────────
  r := pg_temp.as_user(teach_a, format('SELECT public.admin_revoke_teacher_account(%L::uuid)::text', trow_a));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('060002 revoke teacher, role gate','teacher of school A','ERROR Only admins',r,
     CASE WHEN r LIKE 'ERROR%Only admins%' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 4. Deactivate: own school, and the MEMBERSHIP must go ──────────────
  r := pg_temp.as_user(admin_a, format('SELECT public.admin_set_teacher_access(%L::uuid, false)::text', trow_a));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('060002 set teacher access own school (positive control)','admin of school A','OK',r,
     CASE WHEN r LIKE 'OK%' THEN 'PASS' ELSE 'FAIL' END);

  SELECT count(*) INTO n FROM public.memberships
   WHERE account_id = tuser_a AND school_id = sch_a AND role = 'teacher' AND status = 'active';
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('060002 deactivating REVOKED the membership','-','OK: 0','OK: '||n,
     CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END);

  -- ...and back, so the test proves a toggle rather than a one-way break.
  r := pg_temp.as_user(admin_a, format('SELECT public.admin_set_teacher_access(%L::uuid, true)::text', trow_a));
  SELECT count(*) INTO n FROM public.memberships
   WHERE account_id = tuser_a AND school_id = sch_a AND role = 'teacher' AND status = 'active';
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('060002 reactivating GRANTED it back','admin of school A','OK: 1','OK: '||n,
     CASE WHEN n = 1 THEN 'PASS' ELSE 'FAIL' END);

  -- ── 2/3. Revoke on own school works, and clears the membership ─────────
  r := pg_temp.as_user(admin_a, format('SELECT public.admin_revoke_teacher_account(%L::uuid)::text', trow_a));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('060002 revoke teacher own school (positive control)','admin of school A','OK',r,
     CASE WHEN r LIKE 'OK%' THEN 'PASS' ELSE 'FAIL' END);

  SELECT count(*) INTO n FROM public.memberships
   WHERE account_id = tuser_a AND school_id = sch_a AND role = 'teacher' AND status = 'active';
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('060002 revoke cleared the membership, not a user_roles row','-','OK: 0','OK: '||n,
     CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END);

  SELECT count(*) INTO n FROM public.teachers WHERE id = trow_a AND user_id IS NULL AND status = 'inactive';
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('060002 revoke also unlinked the teachers row','-','OK: 1','OK: '||n,
     CASE WHEN n = 1 THEN 'PASS' ELSE 'FAIL' END);

  -- ── 6. The dropped functions are gone ──────────────────────────────────
  r := pg_temp.as_user(admin_a, 'SELECT public.ensure_default_role()::text');
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('060002 ensure_default_role is gone','admin of school A','ERROR does not exist',r,
     CASE WHEN r LIKE 'ERROR%does not exist%' THEN 'PASS' ELSE 'FAIL' END);

  r := pg_temp.as_user(admin_a, format('SELECT public.admin_assign_role(%L, ''teacher''::public.app_role)::text', 'nobody@example.test'));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('060002 admin_assign_role is gone','admin of school A','ERROR does not exist',r,
     CASE WHEN r LIKE 'ERROR%does not exist%' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 7. ...and the overload that does the work is NOT ───────────────────
  -- Two-argument call must now fail to resolve; three-argument must still run.
  -- Without this pair, dropping BOTH overloads would look like a pass.
  -- Measured pre-migration: a two-argument call was AMBIGUOUS ("is not unique"),
  -- because the surviving overload declares `_as text DEFAULT 'student'`. So the
  -- orphan was not merely uncalled, it made every two-argument call fail. With it
  -- dropped, the same call resolves to the fenced three-argument form and does the
  -- rendezvous -- which is the behaviour worth asserting, rather than the shape
  -- claim the migration's own verification block already makes.
  r := pg_temp.as_user(admin_a, format('SELECT coalesce(public.admin_connect_student_account(%L::uuid, %L)::text,''pending'')',
       (SELECT id FROM public.students WHERE school_id = sch_a AND user_id IS NULL LIMIT 1),
       'probe14.twoarg@wisdomcampus.test'));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('060002 a two-arg call now resolves, instead of being ambiguous','admin of school A','OK: pending',r,
     CASE WHEN r = 'OK: pending' THEN 'PASS' ELSE 'FAIL' END);

  r := pg_temp.as_user(admin_a, format('SELECT coalesce(public.admin_connect_student_account(%L::uuid, %L, %L)::text,''pending'')',
       (SELECT id FROM public.students WHERE school_id = sch_a AND user_id IS NULL LIMIT 1),
       'probe14.rendezvous@wisdomcampus.test', 'student'));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('060002 three-arg connect survives, rendezvous records the identity','admin of school A','OK: pending',r,
     CASE WHEN r = 'OK: pending' THEN 'PASS' ELSE 'FAIL' END);
END $probe$;

SELECT n, area, role_tested, expected, observed, verdict FROM probe ORDER BY n;
ROLLBACK;
