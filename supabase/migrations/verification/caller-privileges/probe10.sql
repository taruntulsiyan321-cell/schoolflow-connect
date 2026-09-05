-- probe10: the battle report collector, run as the caller it is meant to have.
--
-- 20260905100000 gave `battle_reports.expires_at` a collector. It had none for
-- the life of the feature: one row four weeks past its own expiry was still
-- present, while the UI told the student the analytics lasted 24 hours.
--
-- Three claims, and the third is what makes the first two mean anything:
--
--   1. a signed-in caller is REFUSED — it is a platform job, not a user action
--   2. running as cron, an EXPIRED report is deleted
--   3. running as cron, an UNEXPIRED report SURVIVES
--
-- Without (3), `DELETE FROM battle_reports` with no WHERE clause passes (1) and
-- (2) perfectly while destroying every live report in the product. A check that
-- cannot tell the fix from the disaster is not a check (G11, rule 8).
--
-- ── THE FIXTURE IS BUILT, NOT BORROWED ────────────────────────────────────
--
-- The one live report is already expired, so borrowing it could only exercise
-- half the behaviour. `battle_reports.participant_id` is UNIQUE and FKs to
-- `battle_participants`, so this claims two participants no report references
-- yet rather than inventing battles.
--
-- The denial is matched on the job's own message, not on the bare word ERROR: a
-- permission-denied, a typo, or a missing function would otherwise all score
-- PASS.
--
-- Everything runs inside the transaction the harness rolls back.
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
  admin_a    uuid := 'd1000001-0001-4000-8000-000000000001';
  p_old      uuid; b_old  uuid; sch uuid;
  p_live     uuid; b_live uuid;
  r          text;
  _res       jsonb;
  _old_left  int;
  _live_left int;
BEGIN
  SELECT bp.id, bp.battle_id, b.school_id INTO p_old, b_old, sch
    FROM public.battle_participants bp
    JOIN public.battles b ON b.id = bp.battle_id
   WHERE NOT EXISTS (SELECT 1 FROM public.battle_reports r2 WHERE r2.participant_id = bp.id)
   ORDER BY bp.id LIMIT 1;

  SELECT bp.id, bp.battle_id INTO p_live, b_live
    FROM public.battle_participants bp
   WHERE bp.id IS DISTINCT FROM p_old
     AND NOT EXISTS (SELECT 1 FROM public.battle_reports r2 WHERE r2.participant_id = bp.id)
   ORDER BY bp.id LIMIT 1;

  IF p_old IS NULL OR p_live IS NULL THEN
    INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
      ('100000 fixture','-','two battle_participants with no report yet',
       format('expired=%s live=%s', coalesce(p_old::text,'null'), coalesce(p_live::text,'null')),'FAIL');
    RETURN;
  END IF;

  INSERT INTO public.battle_reports (participant_id, battle_id, user_id, display_name, report, expires_at, school_id)
  VALUES (p_old,  b_old,  admin_a, 'probe expired', '{"probe":"expired"}'::jsonb, now() - interval '2 days', sch),
         (p_live, b_live, admin_a, 'probe live',    '{"probe":"live"}'::jsonb,    now() + interval '2 days', sch);

  -- ── 1. The refusal ────────────────────────────────────────────────────
  r := pg_temp.as_user(admin_a, 'SELECT public.rpc_purge_expired_battle_reports()::text');
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('100000 collector refuses a signed-in caller','admin of school A',
     'ERROR scheduled job / permission denied', left(r,110),
     CASE WHEN r LIKE 'ERROR%' AND (r ILIKE '%scheduled job%' OR r ILIKE '%permission denied%')
          THEN 'PASS' ELSE 'FAIL' END);

  SELECT count(*) INTO _old_left FROM public.battle_reports WHERE participant_id = p_old;
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('100000 the refused call deleted nothing','-','OK: 1','OK: '||_old_left::text,
     CASE WHEN _old_left = 1 THEN 'PASS' ELSE 'FAIL' END);

  -- ── 2 & 3. The cron path ──────────────────────────────────────────────
  -- as_user() restores `role` but NOT request.jwt.claims, so auth.uid() would
  -- still resolve to the last impersonated user and the job would refuse
  -- itself. Clearing the claim is what makes this the cron path rather than a
  -- signed-in one — and getting it wrong would have looked like a pass.
  PERFORM set_config('request.jwt.claims', '', true);
  _res := public.rpc_purge_expired_battle_reports();

  SELECT count(*) INTO _old_left  FROM public.battle_reports WHERE participant_id = p_old;
  SELECT count(*) INTO _live_left FROM public.battle_reports WHERE participant_id = p_live;

  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('100000 collector removes an EXPIRED report','cron (no auth.uid)','OK: 0 left',
     format('OK: %s left, purged %s', _old_left, coalesce(_res->>'battle_reports_purged','null')),
     CASE WHEN _old_left = 0 AND coalesce((_res->>'battle_reports_purged')::int,0) >= 1
          THEN 'PASS' ELSE 'FAIL' END);

  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('100000 an UNEXPIRED report survives (positive control)','cron (no auth.uid)','OK: 1 left',
     'OK: '||_live_left::text||' left',
     CASE WHEN _live_left = 1 THEN 'PASS' ELSE 'FAIL' END);

  -- ── 4. The durable record is out of the blast radius ──────────────────
  -- XP and league live in progression_history / student_xp and the winner in
  -- battles.status, all written at finish. The collector must reach the report
  -- and nothing behind it.
  INSERT INTO probe(area,role_tested,expected,observed,verdict)
  SELECT '100000 battle and participant survive the purge','-','OK: both present',
         format('OK: battles %s, participants %s',
                (SELECT count(*) FROM public.battles WHERE id = b_old),
                (SELECT count(*) FROM public.battle_participants WHERE id = p_old)),
         CASE WHEN (SELECT count(*) FROM public.battles WHERE id = b_old) = 1
               AND (SELECT count(*) FROM public.battle_participants WHERE id = p_old) = 1
              THEN 'PASS' ELSE 'FAIL' END;

  -- ── 5. The job is registered, active, and singular ────────────────────
  INSERT INTO probe(area,role_tested,expected,observed,verdict)
  SELECT '100000 collector cron job registered','-','OK: 1 active',
         'OK: '||count(*)::text||' active',
         CASE WHEN count(*) = 1 THEN 'PASS' ELSE 'FAIL' END
    FROM cron.job WHERE jobname = 'purge-expired-battle-reports' AND active;
END $probe$;
SELECT area, role_tested, expected, observed, verdict FROM probe ORDER BY n;
ROLLBACK;
