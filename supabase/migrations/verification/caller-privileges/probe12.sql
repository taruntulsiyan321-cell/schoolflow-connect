-- probe12: has_role's school-scoped signature, and what each caller can get.
--
-- 20260905120000 added `has_role(user, role, school_id)` as the cross-account
-- predicate and made `has_role(user, role)` resolve the caller's school and
-- delegate.
--
-- ── ONE LIMIT OF THIS PROBE, STATED UP FRONT ─────────────────────────────
--
-- The harness runs through the management API, so it cannot literally BE
-- `service_role`. What it can reproduce exactly is the condition that broke the
-- function: `auth.uid()` IS NULL. That is what a service-role client has, it is
-- the whole mechanism of the defect, and clearing `request.jwt.claims` produces
-- it faithfully. Where an assertion below says "no session" it means that, and
-- not "authenticated as service_role".
--
-- The claims are therefore:
--
--   1. no session + two-arg   → false. Unchanged, and CORRECT: the question
--                               named no institution.
--   2. no session + three-arg → true. The unblock.
--   3. no session + three-arg, WRONG school → false. Without this, the new
--      signature would be a bypass rather than a scoped predicate.
--   4. authenticated, own role, two-arg → true. The positive control that the
--      session path still works.
--   5. authenticated, cross-account, two-arg → true. Delegation did not break
--      the branch it replaced.
--   6. authenticated, a role they do not hold → false.
--
-- Read-only throughout; the transaction is rolled back regardless.
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
  admin_a   uuid := 'd1000001-0001-4000-8000-000000000001';
  teacher_a uuid := 'd1000002-0001-4000-8000-000000000001';
  sch_a     uuid := '00000000-0000-4000-8000-000000000001';
  sch_b     uuid := '00000000-0000-4000-8000-000000000002';
  r text; b boolean;
BEGIN
  -- ── 1. No session, two-arg: still false, and that is the right answer ──
  PERFORM set_config('request.jwt.claims', '', true);
  SELECT public.has_role(teacher_a, 'teacher') INTO b;
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('120000 two-arg with NO session','no session (as service-role is)','OK: false - named no institution',
     'OK: '||coalesce(b::text,'null'),
     CASE WHEN b IS NOT TRUE THEN 'PASS' ELSE 'FAIL' END);

  -- ── 2. No session, three-arg with the right school: TRUE. The unblock. ─
  SELECT public.has_role(teacher_a, 'teacher', sch_a) INTO b;
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('120000 three-arg with NO session, right school','no session','OK: true',
     'OK: '||coalesce(b::text,'null'),
     CASE WHEN b IS TRUE THEN 'PASS' ELSE 'FAIL' END);

  -- ── 3. No session, three-arg, WRONG school: false ─────────────────────
  -- This is the assertion that makes the new signature a scoped predicate
  -- rather than an escape hatch. Without it, (2) would pass for a function
  -- that ignored its third argument entirely.
  SELECT public.has_role(teacher_a, 'teacher', sch_b) INTO b;
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('120000 three-arg, WRONG school (the scoping control)','no session','OK: false',
     'OK: '||coalesce(b::text,'null'),
     CASE WHEN b IS NOT TRUE THEN 'PASS' ELSE 'FAIL' END);

  -- A NULL school must also be false, or "unscoped" would silently mean "any".
  SELECT public.has_role(teacher_a, 'teacher', NULL) INTO b;
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('120000 three-arg, NULL school','no session','OK: false',
     'OK: '||coalesce(b::text,'null'),
     CASE WHEN b IS NOT TRUE THEN 'PASS' ELSE 'FAIL' END);

  -- ── 4. Authenticated, own role: the session path still works ──────────
  r := pg_temp.as_user(admin_a, format('SELECT public.has_role(%L::uuid, ''admin'')::text', admin_a));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('120000 own role, two-arg (positive control)','admin of school A','OK: true',r,
     CASE WHEN r = 'OK: true' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 5. Authenticated, cross-account: delegation kept it working ───────
  r := pg_temp.as_user(admin_a, format('SELECT public.has_role(%L::uuid, ''teacher'')::text', teacher_a));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('120000 cross-account, two-arg, same school','admin of school A','OK: true',r,
     CASE WHEN r = 'OK: true' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 6. Authenticated, a role they do not hold ─────────────────────────
  r := pg_temp.as_user(teacher_a, format('SELECT public.has_role(%L::uuid, ''admin'')::text', teacher_a));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('120000 a role the caller does not hold','teacher of school A','OK: false',r,
     CASE WHEN r = 'OK: false' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 7. No service-role escape hatch was introduced ────────────────────
  INSERT INTO probe(area,role_tested,expected,observed,verdict)
  SELECT '120000 no service_role bypass in either overload','-','OK: absent',
         CASE WHEN bool_or(pg_get_functiondef(p.oid) ~* 'service_role')
              THEN 'OK: present' ELSE 'OK: absent' END,
         CASE WHEN bool_or(pg_get_functiondef(p.oid) ~* 'service_role') THEN 'FAIL' ELSE 'PASS' END
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'has_role';
END $probe$;
SELECT area, role_tested, expected, observed, verdict FROM probe ORDER BY n;
ROLLBACK;
