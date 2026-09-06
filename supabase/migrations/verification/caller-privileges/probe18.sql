-- probe18: publish_due_scheduled_homework, as the caller.
--
-- 20260908000000 fixed three defects on one SECURITY DEFINER function.
--
-- THE CLAIMS
--   1. a STUDENT cannot publish ANOTHER SCHOOL's scheduled homework.
--      Before the fix this SUCCEEDED — the function took _school_id from the
--      caller and never checked it belonged to them.
--   2. ...and the other school's row is still scheduled afterwards.
--   3. NULL no longer means "every school": a caller passing NULL touches only
--      their own, so a school-B row survives a school-A caller's NULL sweep.
--   4. the caller's OWN school still publishes.            (positive control)
--   5. ...and the row really did become published.         (positive control)
--   6. the call no longer raises 42703 on tests.updated_at.
--   7. only ONE overload remains, so the zero-argument call is no longer
--      PGRST203-ambiguous.
--   8. tests.updated_at exists and its trigger moves it.   (positive control)
--
-- 4, 5 and 8 are what would catch a fence that simply broke the feature.
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
  hw_b    uuid;   -- a DUE scheduled homework at school B
  hw_a    uuid;   -- a DUE scheduled homework at school A
  n_over  int;
  r text;
BEGIN
  SELECT id INTO cls_a FROM public.classes WHERE school_id = sch_a ORDER BY id LIMIT 1;
  SELECT id INTO cls_b FROM public.classes WHERE school_id = sch_b ORDER BY id LIMIT 1;
  IF cls_a IS NULL OR cls_b IS NULL THEN
    RAISE EXCEPTION 'probe18: need a class in each school to hang the fixtures on';
  END IF;

  -- One due scheduled homework in each school. Both are ripe: a correct
  -- function publishes the caller's own and never the other one.
  INSERT INTO public.homework (school_id, class_id, title, due_date, status, scheduled_publish_at)
  VALUES (sch_b, cls_b, 'probe18 school B', current_date + 7, 'scheduled', now() - interval '1 hour')
  RETURNING id INTO hw_b;
  INSERT INTO public.homework (school_id, class_id, title, due_date, status, scheduled_publish_at)
  VALUES (sch_a, cls_a, 'probe18 school A', current_date + 7, 'scheduled', now() - interval '1 hour')
  RETURNING id INTO hw_a;

  -- ── 1/2. the cross-tenant call ─────────────────────────────────────────
  r := pg_temp.as_user(stu_a, format(
        'SELECT public.publish_due_scheduled_homework(%L::uuid)::text', sch_b));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('publish ANOTHER school''s scheduled work','student (school A)','ERROR outside your school',r,
     CASE WHEN r LIKE 'ERROR%outside your school%' THEN 'PASS' ELSE 'FAIL' END);

  INSERT INTO probe(area,role_tested,expected,observed,verdict)
  SELECT 'school B row survives that call','-','scheduled', status,
         CASE WHEN status = 'scheduled' THEN 'PASS' ELSE 'FAIL' END
    FROM public.homework WHERE id = hw_b;

  -- ── 3. NULL is no longer "every school" ────────────────────────────────
  r := pg_temp.as_user(stu_a, 'SELECT public.publish_due_scheduled_homework(NULL::uuid)::text');
  INSERT INTO probe(area,role_tested,expected,observed,verdict)
  SELECT 'NULL sweeps only the caller''s own school','student (school A)',
         'school B still scheduled', 'call: ' || r || ' / school B: ' || status,
         CASE WHEN status = 'scheduled' THEN 'PASS' ELSE 'FAIL' END
    FROM public.homework WHERE id = hw_b;

  -- ── 4/5. the caller's own school still works (positive controls) ───────
  r := pg_temp.as_user(t1, format(
        'SELECT public.publish_due_scheduled_homework(%L::uuid)::text', sch_a));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('own school publishes (positive control)','teacher (school A)','OK: a count, not ERROR',r,
     CASE WHEN r LIKE 'OK:%' THEN 'PASS' ELSE 'FAIL' END);

  INSERT INTO probe(area,role_tested,expected,observed,verdict)
  SELECT 'the school A row really published (positive control)','-','published', status,
         CASE WHEN status = 'published' THEN 'PASS' ELSE 'FAIL' END
    FROM public.homework WHERE id = hw_a;

  -- ── 6. the 42703 is gone ───────────────────────────────────────────────
  -- The function UPDATEs public.tests unconditionally; before tests.updated_at
  -- existed the whole call aborted with
  -- 42703 column "updated_at" of relation "tests" does not exist.
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('no 42703 on tests.updated_at','teacher (school A)','no such error',r,
     CASE WHEN r NOT LIKE '%42703%' AND r NOT LIKE '%updated_at%does not exist%'
          THEN 'PASS' ELSE 'FAIL' END);

  -- ── 7. the overload ambiguity ──────────────────────────────────────────
  SELECT count(*) INTO n_over
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'publish_due_scheduled_homework';
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('overload count (PGRST203 ambiguity)','-','1', n_over::text,
     CASE WHEN n_over = 1 THEN 'PASS' ELSE 'FAIL' END);

  -- ── 8. tests.updated_at and its trigger (positive control) ─────────────
  INSERT INTO probe(area,role_tested,expected,observed,verdict)
  SELECT 'tests.updated_at exists','-','1', count(*)::text,
         CASE WHEN count(*) = 1 THEN 'PASS' ELSE 'FAIL' END
    FROM information_schema.columns
   WHERE table_schema='public' AND table_name='tests' AND column_name='updated_at';

  -- The column may not exist yet (that is the defect), and a STATIC reference
  -- to it aborts the whole block at execution before anything is measured --
  -- which is exactly what happened on the first run. Dynamic SQL so the probe
  -- runs on both sides of the fix.
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name='tests' AND column_name='updated_at') THEN
    DECLARE
      tst uuid;
      before_ts timestamptz;
      after_ts  timestamptz;
    BEGIN
      EXECUTE 'SELECT id, updated_at FROM public.tests ORDER BY created_at LIMIT 1'
        INTO tst, before_ts;
      IF tst IS NOT NULL THEN
        PERFORM pg_sleep(0.01);
        EXECUTE format('UPDATE public.tests SET title = coalesce(title,$x$x$x$) WHERE id = %L', tst);
        EXECUTE format('SELECT updated_at FROM public.tests WHERE id = %L', tst) INTO after_ts;
        INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
          ('tests_set_updated trigger moves updated_at (positive control)','-','after > before',
           coalesce(after_ts::text,'null'),
           CASE WHEN after_ts IS NOT NULL AND (before_ts IS NULL OR after_ts > before_ts)
                THEN 'PASS' ELSE 'FAIL' END);
      END IF;
    END;
  ELSE
    INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
      ('tests_set_updated trigger moves updated_at (positive control)','-','after > before',
       'tests.updated_at does not exist', 'FAIL');
  END IF;
END $probe$;

SELECT area, role_tested, expected, observed, verdict FROM probe ORDER BY n;
ROLLBACK;
