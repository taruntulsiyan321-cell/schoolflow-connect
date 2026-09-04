-- 20260904190000 — the parent weekly digest: contents, and the sender's gate.
--
-- Verified through rpc_parent_weekly_digest() as a REAL PARENT, against the
-- real week, rather than by reading the function body. The read-only console
-- role cannot execute it at all (it is granted to `authenticated`), which is
-- exactly why this belongs in the harness and not in a DO block.
--
-- Every content assertion is paired with a positive control: the digest must
-- return a child for this parent first, or "the key is absent" would pass for a
-- payload that is empty for an unrelated reason.
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
  par_a uuid := 'd1000004-0001-4000-8000-000000000001';
  r text;
BEGIN
  -- ── Positive control: a real parent, a real week, at least one child ──
  r := pg_temp.as_user(par_a, 'SELECT jsonb_array_length(public.rpc_parent_weekly_digest()->''children'')::text');
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('190000 digest returns children (positive control)','parent','OK: >= 1',r,
     CASE WHEN r LIKE 'OK: %' AND substring(r from 5)::int >= 1 THEN 'PASS' ELSE 'FAIL' END);

  -- ── Rule 17's five items, each by the key that carries it ─────────────
  r := pg_temp.as_user(par_a, 'SELECT ((public.rpc_parent_weekly_digest()->''children''->0) ? ''attendance'')::text');
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('190000 item 1-2 attendance','parent','OK: true',r, CASE WHEN r='OK: true' THEN 'PASS' ELSE 'FAIL' END);

  r := pg_temp.as_user(par_a, 'SELECT ((public.rpc_parent_weekly_digest()->''children''->0->''homework'') ? ''submitted'')::text');
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('190000 item 3 homework completed','parent','OK: true',r, CASE WHEN r='OK: true' THEN 'PASS' ELSE 'FAIL' END);

  r := pg_temp.as_user(par_a, 'SELECT ((public.rpc_parent_weekly_digest()->''children''->0->''homework'') ? ''not_completed'')::text');
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('190000 item 3 homework NOT completed','parent','OK: true',r, CASE WHEN r='OK: true' THEN 'PASS' ELSE 'FAIL' END);

  r := pg_temp.as_user(par_a, 'SELECT ((public.rpc_parent_weekly_digest()->''children''->0) ? ''remarks'')::text');
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('190000 item 4 teacher remark','parent','OK: true',r, CASE WHEN r='OK: true' THEN 'PASS' ELSE 'FAIL' END);

  r := pg_temp.as_user(par_a, 'SELECT ((public.rpc_parent_weekly_digest()->''children''->0) ? ''test_marks'')::text');
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('190000 item 5 test marks','parent','OK: true',r, CASE WHEN r='OK: true' THEN 'PASS' ELSE 'FAIL' END);

  -- ── The removed feature must not have grown back ─────────────────────
  r := pg_temp.as_user(par_a, 'SELECT ((public.rpc_parent_weekly_digest()->''children''->0) ? ''alerts'')::text');
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('190000 alerts key is gone','parent','OK: false - weak-concept alerts do not exist',r,
     CASE WHEN r='OK: false' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 210000: exam marks are the exam report's job, not the digest's ────
  -- Ruled: exam marks have an explicit other home (the exam report, available
  -- all year), so carrying them here duplicated a surface and left a key that
  -- is empty in every week without an exam. The positive control above — the
  -- payload has at least one child, and item 5 `test_marks` IS present — is
  -- what stops this passing for a payload that is empty for another reason.
  r := pg_temp.as_user(par_a, 'SELECT ((public.rpc_parent_weekly_digest()->''children''->0) ? ''exam_marks'')::text');
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('210000 exam_marks absent from the payload','parent','OK: false - the exam report is the other surface',r,
     CASE WHEN r='OK: false' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 210000: a rate nobody measured is NULL, never 0 ──────────────────
  -- "Not entered is never zero" exists for exactly this: `null < 60` is TRUE
  -- in JavaScript, so a 0 here would band a child with no attendance record as
  -- the WORST rung rather than as unknown.
  --
  -- Run against _parent_weekly_digest directly, as postgres, and deliberately
  -- so: this is a property of the COMPUTATION, not of anyone's privileges, and
  -- the windowed signature is REVOKEd from authenticated precisely because
  -- only the wrapper and the cron job may choose a window.
  --
  -- BOTH HALVES ARE ASSERTED. "pct is null" alone would pass for a function
  -- that returned null unconditionally — the same defect one rung down.
  DECLARE
    _empty jsonb;
    _full  jsonb;
    _att   jsonb;
  BEGIN
    -- A window with certainly nothing in it. This child's attendance spans
    -- 2020-01-02 to 2026-08-26, so 1999 is empty by construction.
    _empty := public._parent_weekly_digest(par_a, DATE '1999-01-01', DATE '1999-01-07');
    _att   := _empty->'children'->0->'attendance';

    INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
      ('210000 pct is NULL when nothing was marked','-','OK: marked 0, pct null',
       format('OK: marked %s, pct %s', coalesce(_att->>'marked','(absent)'),
              coalesce(jsonb_typeof(_att->'pct'),'(absent)')),
       CASE WHEN _att->>'marked' = '0' AND jsonb_typeof(_att->'pct') = 'null'
            THEN 'PASS' ELSE 'FAIL' END);

    -- Positive control: in a window that DOES have attendance, pct must be a
    -- number. Without this, the assertion above tests nothing.
    _full := public._parent_weekly_digest(par_a, DATE '2019-01-01', CURRENT_DATE);
    _att  := _full->'children'->0->'attendance';

    INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
      ('210000 pct is a number when something WAS marked (positive control)','-','OK: marked > 0, pct number',
       format('OK: marked %s, pct %s', coalesce(_att->>'marked','(absent)'),
              coalesce(jsonb_typeof(_att->'pct'),'(absent)')),
       CASE WHEN coalesce((_att->>'marked')::int,0) > 0 AND jsonb_typeof(_att->'pct') = 'number'
            THEN 'PASS' ELSE 'FAIL' END);
  END;

  -- §10.8 — practice is private to the student. No practice figure may appear
  -- in a parent payload under any key.
  r := pg_temp.as_user(par_a, 'SELECT (public.rpc_parent_weekly_digest()::text ILIKE ''%practice%'')::text');
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('190000 no practice data reaches the parent','parent','OK: false',r,
     CASE WHEN r='OK: false' THEN 'PASS' ELSE 'FAIL' END);

  -- ── The digest is still parent-only ──────────────────────────────────
  r := pg_temp.as_user('d1000003-0001-4000-8000-000000000001'::uuid, 'SELECT (public.rpc_parent_weekly_digest() ? ''children'')::text');
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('190000 digest','student','ERROR Parent only',r,
     CASE WHEN r LIKE 'ERROR%Parent only%' THEN 'PASS' ELSE 'FAIL' END);

  -- ── The sender refuses a signed-in caller ────────────────────────────
  -- Without this, any parent could fan out a notification to every parent in
  -- every school.
  r := pg_temp.as_user(par_a, 'SELECT (public.rpc_send_parent_weekly_digests() ? ''sent'')::text');
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('190000 sender refuses a per-user caller','parent','ERROR scheduled job / permission',r,
     CASE WHEN r LIKE 'ERROR%' THEN 'PASS' ELSE 'FAIL' END);

  -- ── The sender actually sends, run for real and rolled back ──────────
  -- as_user() restores `role` but NOT request.jwt.claims, so auth.uid() would
  -- still resolve to the last impersonated user and the job would refuse
  -- itself. Clearing the claim is what makes this the cron path rather than a
  -- signed-in one — and getting it wrong would have looked like a pass.
  PERFORM set_config('request.jwt.claims', '', true);

  DECLARE
    _before int;
    _after  int;
    _res    jsonb;
  BEGIN
    SELECT count(*) INTO _before FROM public.notifications WHERE user_id = par_a;
    _res := public.rpc_send_parent_weekly_digests();
    SELECT count(*) INTO _after FROM public.notifications WHERE user_id = par_a;

    INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
      ('200000 scheduled sender runs','cron (no auth.uid)','OK: sent >= 1',
       'OK: sent ' || coalesce(_res->>'sent','null') || ', skipped ' || coalesce(_res->>'skipped_no_children','null'),
       CASE WHEN coalesce((_res->>'sent')::int,0) >= 1 THEN 'PASS' ELSE 'FAIL' END);

    -- The count must actually move. "sent: 3" with no new rows would mean the
    -- job counted work it did not do.
    INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
      ('200000 a real notification row lands','cron (no auth.uid)','OK: more than before',
       format('OK: %s -> %s', _before, _after),
       CASE WHEN _after > _before THEN 'PASS' ELSE 'FAIL' END);
  END;

  -- The job is registered, active, and there is exactly one of it.
  INSERT INTO probe(area,role_tested,expected,observed,verdict)
  SELECT '200000 cron job registered','-','OK: 1 active weekly job',
         'OK: ' || count(*)::text || ' active',
         CASE WHEN count(*) = 1 THEN 'PASS' ELSE 'FAIL' END
    FROM cron.job
   WHERE command ~ 'rpc_send_parent_weekly_digests' AND active;
END $probe$;
SELECT area, role_tested, expected, observed, verdict FROM probe ORDER BY n;
ROLLBACK;
