-- probe18: the scheduled publisher, as the caller.
--
-- 20260908000000 fenced `publish_due_scheduled_homework(_school_id)`; the
-- homework ruling of 2026-09-13 (20260925100000) replaced it with
-- `publish_due_scheduled_work()`, run every minute by pg_cron, because any
-- signed-in session — a student's included — could call the old one, and page
-- loads called it in place of a scheduler. This probe asserts the replacement.
--
-- THE CLAIMS
--   1. a STUDENT cannot run the publisher.
--   2. ...and nothing was published by that attempt.
--   3. a TEACHER runs it for their own school.                (positive control)
--   4. ...and their school's due homework really published.   (positive control)
--   5. ...but another school's due homework did not.
--   6. the scheduler (nobody signed in) publishes every school's. (positive control)
--   7. a deleted scheduled homework is never published.
--   8. the old publisher is gone; one zero-argument publisher remains.
--   9. the pg_cron job exists and calls it.
--  10. tests.updated_at exists and its trigger moves it — the publisher
--      updates tests too, and once raised 42703 there.       (positive control)
--
-- 3, 4, 6 and 10 are what would catch a fence that simply broke the feature.
--
-- Every write is rolled back.
BEGIN;
SET LOCAL statement_timeout = '90s';
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
  stu_a   uuid := 'd1000003-0009-4000-8000-000000000009';  -- student, school A
  t1      uuid := 'd1000002-0001-4000-8000-000000000001';  -- teacher, school A
  sch_a   uuid := '00000000-0000-4000-8000-000000000001';
  sch_b   uuid := '00000000-0000-4000-8000-000000000002';
  cls_a   uuid;
  cls_b   uuid;
  hw_a    uuid;   -- a DUE scheduled homework at school A
  hw_b    uuid;   -- a DUE scheduled homework at school B
  hw_del  uuid;   -- a DUE scheduled homework at school A, deleted
  n_old   int;
  n_new   int;
  r text;
BEGIN
  SELECT id INTO cls_a FROM public.classes WHERE school_id = sch_a ORDER BY id LIMIT 1;
  SELECT id INTO cls_b FROM public.classes WHERE school_id = sch_b ORDER BY id LIMIT 1;
  IF cls_a IS NULL OR cls_b IS NULL THEN
    RAISE EXCEPTION 'probe18: need a class in each school to hang the fixtures on';
  END IF;

  -- Due scheduled homework in each school, written as the server (nobody
  -- signed in). All are ripe: released an hour ago, deadline a week out.
  PERFORM set_config('request.jwt.claims', '', true);
  INSERT INTO public.homework (school_id, class_id, subject, title, description, closes_at, status, scheduled_publish_at)
  VALUES (sch_a, cls_a, 'Mathematics', 'probe18 school A', 'q', now() + interval '7 days', 'scheduled', now() - interval '1 hour')
  RETURNING id INTO hw_a;
  INSERT INTO public.homework (school_id, class_id, subject, title, description, closes_at, status, scheduled_publish_at)
  VALUES (sch_b, cls_b, 'Mathematics', 'probe18 school B', 'q', now() + interval '7 days', 'scheduled', now() - interval '1 hour')
  RETURNING id INTO hw_b;
  -- Deleted AFTER it is written: the lifecycle trigger clears deleted_at on
  -- INSERT, because a new row is never born in the trash.
  INSERT INTO public.homework (school_id, class_id, subject, title, description, closes_at, status, scheduled_publish_at)
  VALUES (sch_a, cls_a, 'Mathematics', 'probe18 deleted', 'q', now() + interval '7 days', 'scheduled', now() - interval '1 hour')
  RETURNING id INTO hw_del;
  UPDATE public.homework SET deleted_at = now() WHERE id = hw_del;

  -- ── 1/2. the student is refused, and nothing moved ─────────────────────
  r := pg_temp.as_user(stu_a, 'SELECT public.publish_due_scheduled_work()::text');
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('run the scheduled publisher','student (school A)','ERROR only school staff',r,
     CASE WHEN r LIKE 'ERROR%Only school staff%' THEN 'PASS' ELSE 'FAIL' END);
  INSERT INTO probe(area,role_tested,expected,observed,verdict)
  SELECT 'school A row survives the refused call','-','scheduled', status,
         CASE WHEN status = 'scheduled' THEN 'PASS' ELSE 'FAIL' END
    FROM public.homework WHERE id = hw_a;

  -- ── 3/4/5. a teacher publishes their own school only ───────────────────
  r := pg_temp.as_user(t1, 'SELECT public.publish_due_scheduled_work()::text');
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('own school publishes (positive control)','teacher (school A)','OK: a count, not ERROR',r,
     CASE WHEN r LIKE 'OK:%' AND r NOT LIKE '%42703%' THEN 'PASS' ELSE 'FAIL' END);
  INSERT INTO probe(area,role_tested,expected,observed,verdict)
  SELECT 'the school A row really published (positive control)','-','published', status,
         CASE WHEN status = 'published' THEN 'PASS' ELSE 'FAIL' END
    FROM public.homework WHERE id = hw_a;
  INSERT INTO probe(area,role_tested,expected,observed,verdict)
  SELECT 'school B''s row is untouched by a school A teacher','-','scheduled', status,
         CASE WHEN status = 'scheduled' THEN 'PASS' ELSE 'FAIL' END
    FROM public.homework WHERE id = hw_b;

  -- ── 6/7. the scheduler publishes every school's, never a deleted row ───
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM public.publish_due_scheduled_work();
  INSERT INTO probe(area,role_tested,expected,observed,verdict)
  SELECT 'the scheduler publishes school B''s row (positive control)','scheduler','published', status,
         CASE WHEN status = 'published' THEN 'PASS' ELSE 'FAIL' END
    FROM public.homework WHERE id = hw_b;
  INSERT INTO probe(area,role_tested,expected,observed,verdict)
  SELECT 'a deleted scheduled homework is never published','scheduler','scheduled', status,
         CASE WHEN status = 'scheduled' THEN 'PASS' ELSE 'FAIL' END
    FROM public.homework WHERE id = hw_del;

  -- ── 8. one publisher ───────────────────────────────────────────────────
  SELECT count(*) INTO n_old FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'publish_due_scheduled_homework';
  SELECT count(*) INTO n_new FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'publish_due_scheduled_work' AND p.pronargs = 0;
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('old publisher gone / one zero-argument publisher','-','0 / 1', n_old || ' / ' || n_new,
     CASE WHEN n_old = 0 AND n_new = 1 THEN 'PASS' ELSE 'FAIL' END);

  -- ── 9. the job ─────────────────────────────────────────────────────────
  INSERT INTO probe(area,role_tested,expected,observed,verdict)
  SELECT 'pg_cron job publish-due-scheduled-work calls the publisher','-','1', count(*)::text,
         CASE WHEN count(*) = 1 THEN 'PASS' ELSE 'FAIL' END
    FROM cron.job WHERE jobname = 'publish-due-scheduled-work' AND command LIKE '%publish_due_scheduled_work()%';

  -- ── 10. tests.updated_at and its trigger (positive control) ────────────
  DECLARE
    tst uuid;
    before_ts timestamptz;
    after_ts  timestamptz;
  BEGIN
    SELECT id, updated_at INTO tst, before_ts FROM public.tests ORDER BY created_at LIMIT 1;
    IF tst IS NOT NULL THEN
      PERFORM pg_sleep(0.01);
      UPDATE public.tests SET title = coalesce(title, 'x') WHERE id = tst;
      SELECT updated_at INTO after_ts FROM public.tests WHERE id = tst;
    END IF;
    INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
      ('tests_set_updated trigger moves updated_at (positive control)','-','after > before',
       coalesce(after_ts::text, 'no test row to move'),
       CASE WHEN after_ts IS NOT NULL AND (before_ts IS NULL OR after_ts > before_ts) THEN 'PASS' ELSE 'FAIL' END);
  END;
END $probe$;

SELECT area, role_tested, expected, observed, verdict FROM probe ORDER BY n;
ROLLBACK;
