-- 20260904220000 — tests → test_attempts is RESTRICT; test_questions stays CASCADE.
--
-- The claim has two halves and BOTH are asserted, because a constraint that
-- refuses everything is not a fix, it is an outage — and a split that only
-- ever proves one side is not a split, it is a coincidence.
--
--   RESTRICT   deleting a test that has ATTEMPTS is refused, even when it has
--              no marks. This is the case test_marks' RESTRICT does not cover.
--   CASCADE    deleting a test that has only QUESTIONS still works, and takes
--              the questions with it. Questions are the test's own body.
--
-- ── WHY THE FIXTURE IS BUILT RATHER THAN BORROWED ────────────────────────
--
-- Two reasons, and the second is the one that would have made this probe lie.
--
--   1. The case under test does not exist in live data. All 72 tests have
--      marks, so "a test with attempts and no marks" — the exact gap this
--      migration closes — has zero live instances. Borrowing a real test would
--      test test_marks' constraint again, not this one.
--
--   2. School B, which owns all 2,520 marks and every attempt, has ZERO
--      profiles and no `created_by` on any test. can_manage_test() admits an
--      admin, the creator, or a teacher of the section, and school B has none
--      of the three — so a DELETE there is refused by RLS before it ever
--      reaches the foreign key. The probe would observe ERROR, score PASS, and
--      have proved nothing. That is the "a refusal you cannot distinguish from
--      a typo is not evidence" trap.
--
-- So the fixture is built in school A, where admin_a exists and
-- can_manage_test() resolves true — and every refusal assertion below matches
-- on the FOREIGN-KEY text and the CONSTRAINT NAME specifically, so an RLS
-- refusal FAILS rather than quietly passing.
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
  t_att     uuid;   -- has an attempt, NO marks   → must be refused
  t_clean   uuid;   -- has neither                → must delete
  t_qs      uuid;   -- has questions only         → must delete, questions go too
  _qs_left  int;
  r text;
BEGIN
  SELECT ss.id INTO ss_a
    FROM public.section_subjects ss
    JOIN public.classes c ON c.id = ss.section_id
   WHERE c.school_id = sch_a
   LIMIT 1;

  IF ss_a IS NULL THEN
    INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
      ('220000 fixture','-','a school-A section_subject','ss=null','FAIL');
    RETURN;
  END IF;

  -- Three tests, same section_subject and same creator, so can_manage_test()
  -- resolves identically for all three. The ONLY difference between the
  -- assertions below is what each test has hanging off it.
  INSERT INTO public.tests (school_id, section_subject_id, max_mark, title, created_by)
  VALUES (sch_a, ss_a, 10, 'probe: has attempts, no marks', admin_a) RETURNING id INTO t_att;
  INSERT INTO public.test_attempts (school_id, test_id, user_id, status)
  VALUES (sch_a, t_att, admin_a, 'in_progress');

  INSERT INTO public.tests (school_id, section_subject_id, max_mark, title, created_by)
  VALUES (sch_a, ss_a, 10, 'probe: nothing attached', admin_a) RETURNING id INTO t_clean;

  INSERT INTO public.tests (school_id, section_subject_id, max_mark, title, created_by)
  VALUES (sch_a, ss_a, 10, 'probe: questions only', admin_a) RETURNING id INTO t_qs;
  INSERT INTO public.test_questions (school_id, test_id, order_index, question)
  VALUES (sch_a, t_qs, 1, 'probe question');

  -- Guard the premise: this test must genuinely have NO marks, or the refusal
  -- below would be test_marks' constraint firing and this probe would be
  -- re-proving 180000 under a new name.
  INSERT INTO probe(area,role_tested,expected,observed,verdict)
  SELECT '220000 fixture has attempts and NO marks','-','OK: attempts 1, marks 0',
         format('OK: attempts %s, marks %s',
                (SELECT count(*) FROM public.test_attempts WHERE test_id = t_att),
                (SELECT count(*) FROM public.test_marks    WHERE test_id = t_att)),
         CASE WHEN (SELECT count(*) FROM public.test_attempts WHERE test_id = t_att) = 1
               AND (SELECT count(*) FROM public.test_marks    WHERE test_id = t_att) = 0
              THEN 'PASS' ELSE 'FAIL' END;

  -- ── 1. The refusal — the gap 180000 left open ─────────────────────────
  -- Matched on the constraint NAME, not the bare word ERROR: an RLS refusal,
  -- or a refusal from test_marks_test_fk, must FAIL this rather than satisfy it.
  r := pg_temp.as_user(admin_a, format('WITH d AS (DELETE FROM public.tests WHERE id=%L RETURNING 1) SELECT count(*)::text FROM d', t_att));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('220000 delete test WITH attempts (no marks)','admin of school A',
     'ERROR foreign key test_attempts_test_id_fkey',r,
     CASE WHEN r LIKE 'ERROR%' AND r ILIKE '%test_attempts_test_id_fkey%' THEN 'PASS' ELSE 'FAIL' END);

  -- The attempt must still be there. A refusal that had already removed
  -- children before failing would still read as ERROR above.
  r := (SELECT count(*)::text FROM public.test_attempts WHERE test_id = t_att);
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('220000 attempt survives the refusal','-','OK: 1','OK: '||r,
     CASE WHEN r = '1' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 2. Positive control — RESTRICT did not simply break deletion ──────
  r := pg_temp.as_user(admin_a, format('WITH d AS (DELETE FROM public.tests WHERE id=%L RETURNING 1) SELECT count(*)::text FROM d', t_clean));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('220000 delete test with NEITHER marks nor attempts (positive control)','admin of school A',
     'OK: 1 - RESTRICT must not block everything',r,
     CASE WHEN r = 'OK: 1' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 3. The other half of the split: questions still CASCADE ──────────
  -- Ruled separately. Questions are the test's own body, not student data, and
  -- a test being deleted should take them with it.
  r := pg_temp.as_user(admin_a, format('WITH d AS (DELETE FROM public.tests WHERE id=%L RETURNING 1) SELECT count(*)::text FROM d', t_qs));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('220000 delete test with QUESTIONS still works','admin of school A',
     'OK: 1 - questions are the test''s own body',r,
     CASE WHEN r = 'OK: 1' THEN 'PASS' ELSE 'FAIL' END);

  -- ...and the questions actually went. A test row deleted while its questions
  -- survive would be an orphan set nothing can reach.
  SELECT count(*) INTO _qs_left FROM public.test_questions WHERE test_id = t_qs;
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('220000 questions cascaded with the test','-','OK: 0','OK: '||_qs_left::text,
     CASE WHEN _qs_left = 0 THEN 'PASS' ELSE 'FAIL' END);

  -- ── 4. The declared shape, read back from the catalogue ──────────────
  -- Cheap, and it is what fails first if someone "harmonises" the two.
  INSERT INTO probe(area,role_tested,expected,observed,verdict)
  SELECT '220000 constraint shapes','-','OK: attempts RESTRICT, questions CASCADE',
         format('OK: attempts %s, questions %s',
                CASE WHEN a.def LIKE '%RESTRICT%' THEN 'RESTRICT'
                     WHEN a.def LIKE '%CASCADE%'  THEN 'CASCADE' ELSE a.def END,
                CASE WHEN q.def LIKE '%RESTRICT%' THEN 'RESTRICT'
                     WHEN q.def LIKE '%CASCADE%'  THEN 'CASCADE' ELSE q.def END),
         CASE WHEN a.def LIKE '%ON DELETE RESTRICT%' AND q.def LIKE '%ON DELETE CASCADE%'
              THEN 'PASS' ELSE 'FAIL' END
    FROM (SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
           WHERE conname='test_attempts_test_id_fkey' AND conrelid='public.test_attempts'::regclass) a,
         (SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
           WHERE conname='test_questions_test_id_fkey' AND conrelid='public.test_questions'::regclass) q;
END $probe$;
SELECT area, role_tested, expected, observed, verdict FROM probe ORDER BY n;
ROLLBACK;
