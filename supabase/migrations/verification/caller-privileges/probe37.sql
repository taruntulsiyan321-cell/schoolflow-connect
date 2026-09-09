-- probe37: a teacher can create a test at all (§7, §10.22).
--
-- WHY THIS EXISTS. `tier1.spec.ts` records `/teacher/exams` and
-- `/teacher/homework` as green. Both are redirects to the class list, so the
-- panels were never mounted and the writes beneath them were never run —
-- KNOWN_ISSUES 23. The audit of 2026-09-08 then found the consequence in the
-- data: 72 tests exist, 0 of them published, and `tests.status` holds exactly
-- one value across the whole database ('submitted'). Not one test in this
-- project was ever created through the app.
--
-- THE CAUSE, measured against the live catalog. `tests` has these columns:
--
--   id school_id academic_year_id section_subject_id created_by topic date
--   max_mark status submitted_at deleted_at deleted_by created_at duration_sec
--   passing_marks published_at title instructions difficulty test_kind
--   total_marks chapter_id chapter chapters topics scheduled_publish_at
--   archived_at updated_at
--
-- `TestService.create` SENT `class_id`, `subject`, `is_published`,
-- `question_count`, `subject_id` and `max_marks` — SIX columns that do not
-- exist — and omitted `section_subject_id` and `max_mark`, which are NOT NULL
-- with no default. Chunk 7.5 replaced `class_id` with `section_subject_id`
-- (§10.22) and dropped `is_published` in favour of `status`; the READER was
-- updated (`isPublishedFlag`, `listForClass`) and the WRITER was not.
--
-- Its fallback insert repeated the same defect, so it could not rescue the
-- first. The service was rewritten on 2026-09-09; claims 2 and 3 keep the old
-- payloads on file so the refusal that used to be the bug is now the guard.
--
-- THE CLAIMS
--   1. the teacher session is genuinely that teacher.        (harness control)
--   2. the payload TestService.create sent before the rewrite is REFUSED.
--   3. its old fallback payload is REFUSED too.              <- no escape hatch
--   4. `max_marks` is not `max_mark` — the plural is the phantom.
--   5. a CORRECT payload from the same teacher SUCCEEDS.     (POSITIVE CONTROL)
--   6. ...and the row it wrote is visible to that teacher.   (POSITIVE CONTROL)
--
-- 5 and 6 are what make 2, 3 and 4 mean anything. Without them a refusal
-- proves only that this teacher cannot write to `tests` at all — RLS, a bad
-- grant, a missing membership — and says nothing about the column shape.
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
  teacher uuid;
  sch_a   uuid := '00000000-0000-4000-8000-000000000001';
  cls10   uuid := 'd2000001-0001-4000-8000-000000000001';  -- 10-A, school A
  ss      uuid;
  r       text;
BEGIN
  SELECT id INTO teacher FROM auth.users WHERE email = 'priya.sharma@wisdomcampus.com';
  IF teacher IS NULL THEN
    RAISE EXCEPTION 'probe37: demo teacher missing — a skipped check is not a passing check';
  END IF;

  SELECT s.id INTO ss
    FROM public.section_subjects s
   WHERE s.section_id = cls10 AND s.school_id = sch_a
   LIMIT 1;
  IF ss IS NULL THEN
    RAISE EXCEPTION 'probe37: 10-A teaches no subject — no section_subject to anchor a test on';
  END IF;

  -- ── 1. the session is real ──────────────────────────────────────────────
  r := pg_temp.as_user(teacher, 'SELECT public.get_my_role()::text');
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('the teacher session really is a teacher (control)','teacher','OK: teacher', r,
     CASE WHEN r = 'OK: teacher' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 2. the payload TestService.create sent BEFORE the rewrite ───────────
  r := pg_temp.as_user(teacher, format(
    $q$WITH ins AS (
         INSERT INTO public.tests
           (class_id, title, subject, created_by, school_id, difficulty, duration_sec,
            instructions, chapter, topic, total_marks, is_published, question_count,
            subject_id, test_kind, max_marks, passing_marks, chapters, topics, status,
            scheduled_publish_at, published_at)
         VALUES (%L,'probe37 extended','Maths',%L,%L,'medium',1800,
                 null,null,null,5,true,0,
                 null,'class_test',5,null,'[]'::jsonb,'[]'::jsonb,'published',
                 null, now())
         RETURNING 1)
       SELECT count(*)::text FROM ins$q$, cls10, teacher, sch_a));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('TestService.create — the payload it sent BEFORE the rewrite','teacher','ERROR: column does not exist', r,
     CASE WHEN r LIKE 'ERROR:%does not exist%' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 3. its old FALLBACK payload ─────────────────────────────────────────
  r := pg_temp.as_user(teacher, format(
    $q$WITH ins AS (
         INSERT INTO public.tests
           (class_id, title, subject, created_by, school_id, difficulty, duration_sec,
            instructions, chapter, topic, total_marks, is_published, question_count)
         VALUES (%L,'probe37 base','Maths',%L,%L,'medium',1800,null,null,null,5,true,0)
         RETURNING 1)
       SELECT count(*)::text FROM ins$q$, cls10, teacher, sch_a));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('TestService.create — its old fallback payload (no escape hatch)','teacher','ERROR: column does not exist', r,
     CASE WHEN r LIKE 'ERROR:%does not exist%' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 4. max_marks is not max_mark ────────────────────────────────────────
  INSERT INTO probe(area,role_tested,expected,observed,verdict)
  SELECT 'the marks column is max_mark (singular); max_marks does not exist','-','max_mark only',
         coalesce(string_agg(column_name, ', ' ORDER BY column_name), '(neither)'),
         CASE WHEN count(*) = 1 AND min(column_name) = 'max_mark' THEN 'PASS' ELSE 'FAIL' END
    FROM information_schema.columns
   WHERE table_schema='public' AND table_name='tests' AND column_name IN ('max_mark','max_marks');

  -- ── 5. THE EXACT PAYLOAD THE REWRITTEN SERVICE SENDS (POSITIVE CONTROL) ─
  --
  -- Every column below is one `TestService.create` writes after the
  -- 2026-09-09 rewrite, in the same order, so this fails the day the service
  -- and the table drift apart again — which is the failure this whole probe
  -- exists to catch early.
  r := pg_temp.as_user(teacher, format(
    $q$WITH ins AS (
         INSERT INTO public.tests
           (school_id, section_subject_id, created_by, title, max_mark,
            total_marks, passing_marks, status, test_kind, difficulty,
            duration_sec, instructions, chapter, topic, chapters, topics,
            scheduled_publish_at, published_at)
         VALUES (%L,%L,%L,'probe37 correct',5,
                 5,null,'published','class_test','medium',
                 1800,null,null,null,'[]'::jsonb,'[]'::jsonb,
                 null, now())
         RETURNING 1)
       SELECT count(*)::text FROM ins$q$, sch_a, ss, teacher));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('TestService.create — the payload it sends AFTER the rewrite (positive control)','teacher','OK: 1', r,
     CASE WHEN r = 'OK: 1' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 5b. the four statuses the builder offers are all accepted ───────────
  -- `tests_status_check` refused 'scheduled' and 'archived' until
  -- 20260915010000, so two of the three buttons on the review step wrote a
  -- value the database threw out.
  r := pg_temp.as_user(teacher, format(
    $q$WITH ins AS (
         INSERT INTO public.tests
           (school_id, section_subject_id, created_by, title, max_mark, status)
         SELECT %L,%L,%L,'probe37 status ' || v, 1, v
           FROM unnest(ARRAY['draft','scheduled','published','archived']) AS v
         RETURNING 1)
       SELECT count(*)::text FROM ins$q$, sch_a, ss, teacher));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('every status the test builder offers is accepted','teacher','OK: 4', r,
     CASE WHEN r = 'OK: 4' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 6. ...and they can read it back (POSITIVE CONTROL) ──────────────────
  r := pg_temp.as_user(teacher,
        $q$SELECT count(*)::text FROM public.tests WHERE title = 'probe37 correct'$q$);
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('...and the row it wrote is readable by its author (positive control)','teacher','OK: 1', r,
     CASE WHEN r = 'OK: 1' THEN 'PASS' ELSE 'FAIL' END);
END $probe$;

SELECT area, role_tested, expected, observed, verdict FROM probe ORDER BY n;
ROLLBACK;
