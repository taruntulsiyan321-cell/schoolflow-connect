-- 20260904180000 — tests → test_marks is ON DELETE RESTRICT.
--
-- The claim: a delete that would destroy marks is REFUSED, and a delete that
-- would not still WORKS. Both halves are asserted, because a constraint that
-- refuses everything is not a fix, it is an outage.
--
-- ── WHY THIS PROBE BUILDS ITS OWN FIXTURE ─────────────────────────────────
--
-- The obvious version — delete one of the 72 live tests that have marks — is
-- unrunnable as a real caller, and finding out why is the point.
--
-- All 2,520 test_marks rows belong to school B. School B has ZERO profiles, and
-- none of its tests has a `created_by`. `can_manage_test()` admits an admin, the
-- creator, or a teacher of the section — school B has none of the three. So a
-- DELETE there is refused by RLS before it ever reaches the foreign key, and the
-- probe would observe an ERROR and score PASS having proved nothing about the
-- constraint. That is the "a refusal you cannot distinguish from a typo is not
-- evidence" trap, one layer along.
--
-- So the fixture is built in school A, where admin_a exists and can_manage_test
-- resolves true — and the assertions below match on the foreign-key text
-- specifically, so an RLS refusal would FAIL rather than quietly pass.
--
-- Everything runs inside the transaction the harness rolls back; no inserted
-- row survives.
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
  admin_a uuid := 'd1000001-0001-4000-8000-000000000001';
  sch_a   uuid := '00000000-0000-4000-8000-000000000001';
  ss_a    uuid;
  stud_a  uuid;
  t_marked uuid;
  t_clean  uuid;
  r text;
BEGIN
  SELECT ss.id INTO ss_a
    FROM public.section_subjects ss
    JOIN public.classes c ON c.id = ss.section_id
   WHERE c.school_id = sch_a
   LIMIT 1;
  SELECT s.id INTO stud_a FROM public.students s WHERE s.school_id = sch_a LIMIT 1;

  IF ss_a IS NULL OR stud_a IS NULL THEN
    INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
      ('180000 fixture','-','a school-A section_subject and student',
       format('ss=%s student=%s', coalesce(ss_a::text,'null'), coalesce(stud_a::text,'null')),'FAIL');
    RETURN;
  END IF;

  -- A test WITH a mark, and one WITHOUT. Same section_subject and creator, so
  -- can_manage_test() resolves identically for both and the only difference
  -- between the two assertions below is the presence of the mark.
  INSERT INTO public.tests (school_id, section_subject_id, max_mark, title, created_by)
  VALUES (sch_a, ss_a, 10, 'probe: has marks', admin_a) RETURNING id INTO t_marked;
  INSERT INTO public.test_marks (school_id, test_id, student_id, mark)
  VALUES (sch_a, t_marked, stud_a, 7);

  INSERT INTO public.tests (school_id, section_subject_id, max_mark, title, created_by)
  VALUES (sch_a, ss_a, 10, 'probe: no marks', admin_a) RETURNING id INTO t_clean;

  -- ── 1. The refusal ────────────────────────────────────────────────────
  -- Matched on foreign-key wording, NOT on the bare word ERROR: an RLS refusal
  -- must fail this assertion rather than satisfy it.
  r := pg_temp.as_user(admin_a, format('WITH d AS (DELETE FROM public.tests WHERE id=%L RETURNING 1) SELECT count(*)::text FROM d', t_marked));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('180000 delete test WITH marks','admin of school A','ERROR foreign key - marks must survive',r,
     CASE WHEN r LIKE 'ERROR%' AND (r ILIKE '%foreign key%' OR r ILIKE '%test_marks_test_fk%') THEN 'PASS' ELSE 'FAIL' END);

  -- The mark must still be there. A refusal that had already removed children
  -- before failing would still read as ERROR above.
  r := (SELECT count(*)::text FROM public.test_marks WHERE test_id = t_marked);
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('180000 mark survives the refusal','-','OK: 1','OK: '||r,
     CASE WHEN r = '1' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 2. The positive control ───────────────────────────────────────────
  -- Proves RESTRICT did not simply break deletion, and that the refusal above
  -- came from the constraint rather than the policy.
  r := pg_temp.as_user(admin_a, format('WITH d AS (DELETE FROM public.tests WHERE id=%L RETURNING 1) SELECT count(*)::text FROM d', t_clean));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('180000 delete test WITHOUT marks (positive control)','admin of school A','OK: 1 - RESTRICT must not block everything',r,
     CASE WHEN r = 'OK: 1' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 3. The purge no longer touches tests ──────────────────────────────
  r := CASE WHEN (SELECT pg_get_functiondef(oid) FROM pg_proc
                   WHERE proname='rpc_purge_expired' AND pronamespace='public'::regnamespace)
                 ~ 'DELETE\s+FROM\s+public\.tests'
            THEN 'OK: still deletes tests' ELSE 'OK: excluded' END;
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('180000 purge excludes tests','-','OK: excluded',r,
     CASE WHEN r = 'OK: excluded' THEN 'PASS' ELSE 'FAIL' END);
END $probe$;
SELECT area, role_tested, expected, observed, verdict FROM probe ORDER BY n;
ROLLBACK;
