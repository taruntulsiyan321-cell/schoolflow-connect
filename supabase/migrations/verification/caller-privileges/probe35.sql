-- probe35: the anon key does not reach the school helpers (§10.19).
--
-- CHUNK95_ANON_SURFACE_VERIFY reported, 2026-09-08:
--   "(FAIL) 1: anon can EXECUTE these and no class explains why —
--    my_visible_exam_ids(), storage_object_owner_school_id(text)."
--
-- `anon` is the key that ships in the browser bundle, so this is what a
-- signed-out visitor with curl could call. 20260914090000 revoked one and
-- dropped the other.
--
-- WHY THIS EXISTS ALONGSIDE THE ANON GATE
--
-- CHUNK95_ANON_SURFACE_VERIFY reads the catalog: it asks who HOLDS the grant.
-- This probe asks the question from the other end — it becomes `anon` and
-- tries the call — because a grant table and an actual refusal are not the same
-- claim, and only one of them is what a visitor experiences.
--
-- THE CLAIMS
--   1. anon is genuinely anon in this session.               (harness control)
--   2. anon CANNOT execute storage_object_owner_school_id.      <- the revoke
--   3. authenticated still CAN.                          (POSITIVE CONTROL)
--   4. my_visible_exam_ids no longer exists for anyone.           <- the drop
--   5. its replacement can_read_exam_row still answers for a real caller.
--   6. a student still reads their own exams end to end.  (POSITIVE CONTROL)
--
-- Claims 3, 5 and 6 are the point. A revoke that also cut off the legitimate
-- roles would satisfy claims 2 and 4 perfectly while making every academic file
-- unreadable and every exam invisible — which is exactly what happened on
-- 2026-09-08 when a DROP took a function's grants with it and seven failing
-- assertions turned out to all be positive controls.
--
-- Every write is rolled back.
BEGIN;
SET LOCAL statement_timeout = '30s';
CREATE TEMP TABLE probe(n serial, area text, role_tested text, expected text, observed text, verdict text) ON COMMIT DROP;

-- Two helpers, because the two roles are reached differently: `anon` has no
-- JWT subject at all, which is the whole point of it.
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
  stu  uuid := 'd1000003-0001-4000-8000-000000000001';
  r    text;
BEGIN
  -- ── 1. anon really is anon ──────────────────────────────────────────────
  -- Without this, every refusal below could be a refusal of something else.
  r := pg_temp.as_anon('SELECT current_user::text');
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('the probe session really is anon (control)','anon','OK: anon', r,
     CASE WHEN r = 'OK: anon' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 2. the revoke ───────────────────────────────────────────────────────
  r := pg_temp.as_anon(
        'SELECT public.storage_object_owner_school_id(''d1000003-0001-4000-8000-000000000001/x.pdf'')::text');
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('call storage_object_owner_school_id','anon (the key in the browser bundle)','ERROR: permission denied', r,
     CASE WHEN r LIKE 'ERROR:%permission denied%' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 3. and the roles that need it keep it (POSITIVE CONTROL) ────────────
  r := pg_temp.as_user(stu,
        'SELECT coalesce(public.storage_object_owner_school_id(''d1000003-0001-4000-8000-000000000001/x.pdf'')::text, ''resolved-null'')');
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('...while a signed-in student still may (positive control)','student','OK: (no permission error)', r,
     CASE WHEN r LIKE 'OK:%' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 4. the drop ─────────────────────────────────────────────────────────
  INSERT INTO probe(area,role_tested,expected,observed,verdict)
  SELECT 'my_visible_exam_ids() exists at all','-','0',
         count(*)::text,
         CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'my_visible_exam_ids';

  -- ── 5. its replacement answers for a real caller ────────────────────────
  r := pg_temp.as_user(stu, 'SELECT public.can_read_exam_row(NULL::uuid, NULL::uuid)::text');
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('can_read_exam_row is callable by a student (positive control)','student','OK: (no permission error)', r,
     CASE WHEN r LIKE 'OK:%' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 6. and the surface it guards still works ────────────────────────────
  -- The claim that matters to a user: exams are still readable. A count is not
  -- asserted -- the fixture data decides that -- only that the read is not
  -- REFUSED, which is what a botched revoke would cause.
  r := pg_temp.as_user(stu, 'SELECT count(*)::text FROM public.exams');
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('a student can still read exams (positive control)','student','OK: (a number, not a refusal)', r,
     CASE WHEN r LIKE 'OK:%' AND r NOT LIKE '%permission denied%' THEN 'PASS' ELSE 'FAIL' END);

  -- Anon must NOT read exams -- the fence this whole area exists for.
  r := pg_temp.as_anon('SELECT count(*)::text FROM public.exams');
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('anon reads exams','anon','OK: 0 (RLS returns nothing)', r,
     CASE WHEN r = 'OK: 0' OR r LIKE 'ERROR:%permission denied%' THEN 'PASS' ELSE 'FAIL' END);
END $probe$;

SELECT area, role_tested, expected, observed, verdict FROM probe ORDER BY n;
ROLLBACK;
