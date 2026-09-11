-- probe42: a student sees THEIR OWN fees and nobody else's (§10, rule 18).
--
-- Fees became a student-facing surface by ruling on 2026-09-11. The screen
-- already existed — `/student/fees` → `MyFeesPage`, which reads `public.fees`
-- directly — and the RLS was never probed. Five policies sit on that table and
-- one of them, `fees teacher read`, is granted to `public` rather than
-- `authenticated`, which is the shape that has produced anon holes here before.
--
-- The table has ZERO rows in this environment, so every claim below would pass
-- vacuously against live data. This probe therefore INSERTS its own fixtures as
-- `postgres` and rolls them back — which is also why the positive controls
-- matter more than usual: without them, a policy that denies everyone would
-- look identical to a policy that works.
--
-- THE CLAIMS
--   1. a student reads their OWN fee row.                    (POSITIVE CONTROL)
--   2. a student CANNOT read another student's fee row.              <- the fence
--   3. a student reads exactly ONE row when two exist, one each.     <- the fence
--   4. anon reads NOTHING, even though a policy names `public`.      <- the grant
--   5. a student cannot UPDATE their own fee row.                    <- read-only
--   6. `fees student read` is keyed on is_my_student_record.         <- the shape
--
-- 1 and 3 are what make 2 mean anything: a table that returns nothing to
-- everybody satisfies "cannot read another student's row" perfectly.
--
-- Every write is rolled back.
BEGIN;
SET LOCAL statement_timeout = '120s';
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

CREATE FUNCTION pg_temp.as_anon(_sql text) RETURNS text
LANGUAGE plpgsql AS $fn$
DECLARE _out text;
BEGIN
  PERFORM set_config('request.jwt.claims', NULL, true);
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

DO $probe$
DECLARE
  stu_a     uuid; uid_a uuid; sch_a uuid;
  stu_b     uuid; uid_b uuid;
  fee_a     uuid;
  fee_b     uuid;
  r         text;
BEGIN
  -- Two students in the SAME school, so the tenant fence is not what does the
  -- work — the per-student policy has to.
  --
  -- Both must hold an ACTIVE STUDENT MEMBERSHIP pointing at their own row.
  -- That is not fixture pedantry: `is_my_student_record` is
  --
  --     active_membership_role() = 'student' AND _student_id = active_local_person_id()
  --
  -- so a student without one gets NULL, and NULL denies. Picking by `ORDER BY
  -- s.id` chose such a student the first time this probe ran, and every
  -- refusal below passed while the two positive controls failed — which is
  -- exactly what the controls are for.
  --
  -- Measured 2026-09-11: 12 of 52 students with a sign-in account hold one.
  -- The other 40 have never signed in and have no legacy role either — seeded
  -- fixtures, not locked-out users. Memberships are granted by invitation
  -- (`rpc_invite_member` / `rpc_respond_to_invitation`), so their absence is
  -- the seed's shape and not a defect to backfill.
  SELECT s.id, s.user_id, s.school_id INTO stu_a, uid_a, sch_a
    FROM public.students s
   WHERE s.user_id IS NOT NULL AND s.deleted_at IS NULL
     AND EXISTS (SELECT 1 FROM public.memberships m
                  WHERE m.account_id = s.user_id AND m.role = 'student'
                    AND m.status = 'active' AND m.local_person_id = s.id)
   ORDER BY s.id LIMIT 1;

  SELECT s.id, s.user_id INTO stu_b, uid_b
    FROM public.students s
   WHERE s.user_id IS NOT NULL AND s.deleted_at IS NULL
     AND s.school_id = sch_a AND s.id <> stu_a
     AND EXISTS (SELECT 1 FROM public.memberships m
                  WHERE m.account_id = s.user_id AND m.role = 'student'
                    AND m.status = 'active' AND m.local_person_id = s.id)
   ORDER BY s.id LIMIT 1;

  IF stu_a IS NULL OR stu_b IS NULL THEN
    INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
      ('fixture: two students with an ACTIVE student membership in one school','-',
       'two', 'not found — this probe cannot say anything without them','FAIL');
    RETURN;
  END IF;

  INSERT INTO public.fees (student_id, month, amount, paid_amount, due_date, school_id, fee_type)
  VALUES (stu_a, '2026-09', 5000, 1000, current_date + 7, sch_a, 'tuition')
  RETURNING id INTO fee_a;

  INSERT INTO public.fees (student_id, month, amount, paid_amount, due_date, school_id, fee_type)
  VALUES (stu_b, '2026-09', 5000, 0, current_date + 7, sch_a, 'tuition')
  RETURNING id INTO fee_b;

  -- ── 1. their own row (POSITIVE CONTROL) ────────────────────────────────
  r := pg_temp.as_user(uid_a, format(
    $q$SELECT count(*)::text FROM public.fees WHERE id = %L$q$, fee_a));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('a student reads their OWN fee row (positive control)','student','OK: 1', r,
     CASE WHEN r = 'OK: 1' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 2. the other student's row ─────────────────────────────────────────
  r := pg_temp.as_user(uid_a, format(
    $q$SELECT count(*)::text FROM public.fees WHERE id = %L$q$, fee_b));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('...and NOT another student''s, same school','student','OK: 0', r,
     CASE WHEN r = 'OK: 0' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 3. the whole table, as that student ────────────────────────────────
  r := pg_temp.as_user(uid_a,
    $q$SELECT count(*)::text FROM public.fees$q$);
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('the table as a whole returns only their own row','student','OK: 1', r,
     CASE WHEN r = 'OK: 1' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 4. anon, despite `fees teacher read` naming `public` ───────────────
  r := pg_temp.as_anon($q$SELECT count(*)::text FROM public.fees$q$);
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('a signed-out visitor reads nothing','anon','OK: 0 or ERROR', r,
     CASE WHEN r = 'OK: 0' OR r LIKE 'ERROR:%' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 5. the surface is READ-only for a student ──────────────────────────
  r := pg_temp.as_user(uid_a, format(
    $q$WITH u AS (UPDATE public.fees SET paid_amount = 5000 WHERE id = %L RETURNING 1)
       SELECT count(*)::text FROM u$q$, fee_a));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('a student cannot pay their own fee off by UPDATE','student','OK: 0 or ERROR', r,
     CASE WHEN r = 'OK: 0' OR r LIKE 'ERROR:%' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 6. the policy is keyed on the student record, not on school ────────
  SELECT 'OK: ' || CASE WHEN qual ILIKE '%is_my_student_record%' THEN 'yes' ELSE qual END
    INTO r
    FROM pg_policies
   WHERE schemaname='public' AND tablename='fees' AND policyname='fees student read';
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('`fees student read` is keyed on is_my_student_record','-','OK: yes', COALESCE(r,'(policy missing)'),
     CASE WHEN r = 'OK: yes' THEN 'PASS' ELSE 'FAIL' END);
END $probe$;

SELECT area, role_tested, expected, observed, verdict FROM probe ORDER BY n;
ROLLBACK;
