-- probe11: the weekly digest reaches a parent who exists only in memberships.
--
-- 20260905110000 repointed `rpc_send_parent_weekly_digests` from
-- `user_roles WHERE role='parent'` to `memberships WHERE role='parent' AND
-- status='active'`.
--
-- ── WHY THIS PROBE HAS TO BUILD ITS FIXTURE ──────────────────────────────
--
-- The bug is invisible in this database. Measured: 3 parents via user_roles, 3
-- via memberships, and ZERO membership-parents missing a user_roles row — the
-- seed wrote both tables. So every existing parent is reachable either way, and
-- borrowing one could not tell the fixed function from the broken one.
--
-- The discriminating case has to be manufactured: an account with an ACTIVE
-- parent membership and NO `user_roles` row for 'parent'. That is exactly the
-- shape `_grant_membership` produces, which is to say the shape every real
-- school will have.
--
-- `user_roles` is read-only at the table level (trg_user_roles_read_only raises
-- on INSERT, UPDATE and DELETE), so the fixture cannot be made by deleting a
-- row. It is made instead by granting a parent membership to someone who is
-- currently a TEACHER — they hold `user_roles.teacher` and no
-- `user_roles.parent`, so the old query misses them and the new one finds them.
--
-- Assertion 1 is the premise: without it, assertion 2 could pass for a user who
-- happened to have a user_roles parent row all along.
--
-- Everything runs inside the transaction the harness rolls back.
BEGIN;
SET LOCAL statement_timeout = '60s';
CREATE TEMP TABLE probe(n serial, area text, role_tested text, expected text, observed text, verdict text) ON COMMIT DROP;
DO $probe$
DECLARE
  sch        uuid := '00000000-0000-4000-8000-000000000001';
  fixture    uuid := 'd1000002-0001-4000-8000-000000000001'; -- a teacher, not a parent
  control    uuid := 'd1000002-0002-4000-8000-000000000002'; -- another teacher, left alone
  kid        uuid;
  _ur_parent int;
  _before_f  int; _after_f  int;
  _before_c  int; _after_c  int;
  _res       jsonb;
BEGIN
  SELECT s.id INTO kid FROM public.students s
   WHERE s.school_id = sch AND s.deleted_at IS NULL
   ORDER BY s.id LIMIT 1;

  IF kid IS NULL THEN
    INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
      ('110000 fixture','-','a school-A student','none found','FAIL');
    RETURN;
  END IF;

  -- The fixture: an active parent membership, and a child pointing at them.
  INSERT INTO public.memberships (account_id, school_id, role, status, responded_at)
  VALUES (fixture, sch, 'parent', 'active', now())
  ON CONFLICT (account_id, school_id, role) DO UPDATE SET status = 'active';

  UPDATE public.students SET parent_user_id = fixture WHERE id = kid;

  -- ── 1. THE PREMISE — no user_roles parent row for this account ────────
  -- If this fails, assertion 2 proves nothing: the old query would have found
  -- them too.
  SELECT count(*) INTO _ur_parent FROM public.user_roles
   WHERE user_id = fixture AND role = 'parent';
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('110000 fixture has NO user_roles parent row','-','OK: 0','OK: '||_ur_parent::text,
     CASE WHEN _ur_parent = 0 THEN 'PASS' ELSE 'FAIL' END);

  SELECT count(*) INTO _before_f FROM public.notifications WHERE user_id = fixture;
  SELECT count(*) INTO _before_c FROM public.notifications WHERE user_id = control;

  -- The cron path: no auth.uid(), or the job refuses itself.
  PERFORM set_config('request.jwt.claims', '', true);
  _res := public.rpc_send_parent_weekly_digests();

  SELECT count(*) INTO _after_f FROM public.notifications WHERE user_id = fixture;
  SELECT count(*) INTO _after_c FROM public.notifications WHERE user_id = control;

  -- ── 2. The membership-only parent is reached ──────────────────────────
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('110000 membership-only parent receives a digest','cron (no auth.uid)','OK: notification count rises',
     format('OK: %s -> %s, job sent %s', _before_f, _after_f, coalesce(_res->>'sent','null')),
     CASE WHEN _after_f > _before_f THEN 'PASS' ELSE 'FAIL' END);

  -- ── 3. The control: a non-parent is NOT reached ───────────────────────
  -- Without this, a function that notified every account would pass (2).
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('110000 a non-parent receives nothing (control)','cron (no auth.uid)','OK: unchanged',
     format('OK: %s -> %s', _before_c, _after_c),
     CASE WHEN _after_c = _before_c THEN 'PASS' ELSE 'FAIL' END);

  -- ── 4. A revoked parent membership is excluded ────────────────────────
  -- status='active' is the filter user_roles could never express.
  UPDATE public.memberships SET status = 'revoked'
   WHERE account_id = fixture AND school_id = sch AND role = 'parent';
  SELECT count(*) INTO _before_f FROM public.notifications WHERE user_id = fixture;
  _res := public.rpc_send_parent_weekly_digests();
  SELECT count(*) INTO _after_f FROM public.notifications WHERE user_id = fixture;

  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('110000 a REVOKED parent receives nothing','cron (no auth.uid)','OK: unchanged',
     format('OK: %s -> %s', _before_f, _after_f),
     CASE WHEN _after_f = _before_f THEN 'PASS' ELSE 'FAIL' END);

  -- ── 5. The function no longer reads user_roles at all ─────────────────
  INSERT INTO probe(area,role_tested,expected,observed,verdict)
  SELECT '110000 sender does not read user_roles','-','OK: absent',
         CASE WHEN pg_get_functiondef(oid) ~* '\muser_roles\M'
              THEN 'OK: still present' ELSE 'OK: absent' END,
         CASE WHEN pg_get_functiondef(oid) ~* '\muser_roles\M' THEN 'FAIL' ELSE 'PASS' END
    FROM pg_proc
   WHERE proname = 'rpc_send_parent_weekly_digests' AND pronamespace = 'public'::regnamespace;
END $probe$;
SELECT area, role_tested, expected, observed, verdict FROM probe ORDER BY n;
ROLLBACK;
