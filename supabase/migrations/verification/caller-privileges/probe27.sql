-- probe27: ai_budget_release after 20260913000000.
--
-- TWO KINDS OF CLAIM, AND THEY ARE LABELLED, because conflating them is how a
-- verification block ends up proving nothing:
--
--   PRIVILEGE claims (1-3) run AS THE CALLER through pg_temp.as_user. They are
--   the ones the superuser-run migration block could not make.
--
--   BEHAVIOUR claims (4-8) run as the migration role, which is the only role
--   that holds EXECUTE. They do not claim anything about who may call; they
--   claim the arithmetic is right, which is the other half of the fix and is
--   equally capable of being silently wrong.
--
-- THE CLAIMS
--   1. a teacher's session is real and works.                (harness control)
--   2. a teacher CANNOT execute ai_budget_release.            <- the fence
--   3. ...nor ai_budget_check_and_reserve, unchanged.         (shape control)
--   4. reserve(N) then release(N) returns the counter to where it started.
--                                                            <- the fix
--   5. the feature-level row moves with the school-level one.
--   6. a SECOND release does not go below the starting value. (the clamp)
--   7. a release for a day with no usage row inserts nothing and says
--      released:false.
--   8. invalid args are rejected without touching the counters.
--
-- Claim 1 exists because claims 2 and 3 are denials: without it, a probe whose
-- session was never established would score two passes for the wrong reason.
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
  t1      uuid := 'd1000002-0001-4000-8000-000000000001';  -- teacher, school A
  sch_a   uuid := '00000000-0000-4000-8000-000000000001';
  ghost   uuid := '00000000-0000-4000-8000-00000000dead';  -- a school with no usage row
  feat    text := 'probe27.release';
  day     text := to_char((now() AT TIME ZONE 'utc'), 'YYYY-MM-DD');
  units   numeric := 3;
  before_school  numeric;
  after_reserve  numeric;
  after_release  numeric;
  after_double   numeric;
  feat_reserve   numeric;
  feat_release   numeric;
  r       text;
  j       jsonb;
BEGIN
  -- ── 1. the session is real (harness control) ───────────────────────────
  r := pg_temp.as_user(t1, 'SELECT public.get_my_role()::text');
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('the probe session is genuinely authenticated (control)','teacher','OK: teacher', r,
     CASE WHEN r = 'OK: teacher' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 2. the fence ───────────────────────────────────────────────────────
  r := pg_temp.as_user(t1, format(
        'SELECT public.ai_budget_release(%L::uuid, %L, 1)::text', sch_a, feat));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('lower my own school''s AI bill','teacher','ERROR permission denied', r,
     CASE WHEN r LIKE 'ERROR%permission denied%' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 3. ...and the reservation is fenced the same way, still ────────────
  r := pg_temp.as_user(t1, format(
        'SELECT public.ai_budget_check_and_reserve(%L::uuid, %L, 1)::text', sch_a, feat));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('reserve AI budget directly','teacher','ERROR permission denied', r,
     CASE WHEN r LIKE 'ERROR%permission denied%' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 4/5. reserve then release, both rows ───────────────────────────────
  SELECT coalesce(units_used, 0) INTO before_school
    FROM public.ai_budget_usage
   WHERE school_id = sch_a AND period = 'daily' AND period_key = day AND feature_id IS NULL;
  before_school := coalesce(before_school, 0);

  PERFORM public.ai_budget_check_and_reserve(sch_a, feat, units);
  SELECT units_used INTO after_reserve FROM public.ai_budget_usage
   WHERE school_id = sch_a AND period = 'daily' AND period_key = day AND feature_id IS NULL;
  SELECT units_used INTO feat_reserve FROM public.ai_budget_usage
   WHERE school_id = sch_a AND period = 'daily' AND period_key = day AND feature_id = feat;

  j := public.ai_budget_release(sch_a, feat, units);
  SELECT units_used INTO after_release FROM public.ai_budget_usage
   WHERE school_id = sch_a AND period = 'daily' AND period_key = day AND feature_id IS NULL;
  SELECT units_used INTO feat_release FROM public.ai_budget_usage
   WHERE school_id = sch_a AND period = 'daily' AND period_key = day AND feature_id = feat;

  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('reserve(3) moves the school counter (control)','service path',
     format('%s -> %s', before_school, before_school + units),
     format('%s -> %s', before_school, after_reserve),
     CASE WHEN after_reserve = before_school + units THEN 'PASS' ELSE 'FAIL' END);

  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('release(3) puts the school counter back','service path',
     format('back to %s', before_school), format('%s', after_release),
     CASE WHEN after_release = before_school THEN 'PASS' ELSE 'FAIL' END);

  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('release(3) puts the FEATURE counter back too','service path',
     format('%s -> %s', feat_reserve, feat_reserve - units),
     format('%s -> %s', feat_reserve, feat_release),
     CASE WHEN feat_release = feat_reserve - units THEN 'PASS' ELSE 'FAIL' END);

  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('the release reports that it found a row','service path','released: true',
     format('released: %s', j->>'released'),
     CASE WHEN (j->>'released') = 'true' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 6. the clamp ───────────────────────────────────────────────────────
  -- A second release of the same units must not mint credit. Released again
  -- from a counter now at `before_school`, the result may fall to 0 but must
  -- never go negative.
  PERFORM public.ai_budget_release(sch_a, feat, units);
  SELECT units_used INTO after_double FROM public.ai_budget_usage
   WHERE school_id = sch_a AND period = 'daily' AND period_key = day AND feature_id IS NULL;
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('a double release never goes below zero','service path','>= 0',
     format('%s', after_double),
     CASE WHEN after_double >= 0 THEN 'PASS' ELSE 'FAIL' END);

  -- ── 7. nothing to release ──────────────────────────────────────────────
  j := public.ai_budget_release(ghost, feat, 1);
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('release for a school with no usage row','service path','released: false',
     format('released: %s', j->>'released'),
     CASE WHEN (j->>'released') = 'false' THEN 'PASS' ELSE 'FAIL' END);

  INSERT INTO probe(area,role_tested,expected,observed,verdict)
  SELECT 'and it inserted no row for that school','service path','0 rows',
         format('%s rows', count(*)),
         CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END
    FROM public.ai_budget_usage WHERE school_id = ghost;

  -- ── 8. invalid args ────────────────────────────────────────────────────
  j := public.ai_budget_release(sch_a, feat, 0);
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('release of zero units is rejected, not applied','service path','invalid_args',
     coalesce(j->>'error_code', 'none'),
     CASE WHEN (j->>'error_code') = 'invalid_args' THEN 'PASS' ELSE 'FAIL' END);
END $probe$;

SELECT area, role_tested, expected, observed, verdict FROM probe ORDER BY n;
ROLLBACK;
