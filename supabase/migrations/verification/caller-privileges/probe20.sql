-- probe20: finalise and publish a sitting, as the caller.
--
-- 20260909010000 added `exams.updated_at`. Both writes in examRepository --
-- setExamLocked (finalise) and setExamResultsPublished (publish results) --
-- set that column, and it did not exist, so PostgREST answered PGRST204 and
-- the teacher saw "This feature isn't available right now."
--
-- THE CLAIMS
--   1. the class teacher can LOCK a sitting of a class they teach, writing
--      updated_at.                                     <- the fix. PGRST204 before.
--   2. the trigger actually moved updated_at.          (positive control)
--      A column with no trigger would satisfy the write and then lie about
--      when the row changed.
--   3. the class teacher can PUBLISH results, writing results_published_at
--      and updated_at together.                        <- the fix.
--   4. ...and results_published_at really landed.       (positive control)
--   5. a teacher who does NOT teach the class cannot lock it -- exams_update
--      is untouched by this migration.
--   6. ...and that sitting is still unlocked afterwards.
--
-- 1-4 are what would catch a fence that simply broke the feature; 5 and 6 are
-- what would catch one that opened it.
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
  t1         uuid := 'd1000002-0001-4000-8000-000000000001';  -- Priya Sharma, teacher, school A
  sch_a      uuid := '00000000-0000-4000-8000-000000000001';
  cls_taught uuid := 'd2000001-0001-4000-8000-000000000001';  -- 10 A, Priya is class teacher
  cls_other  uuid;
  ex_mine    uuid;
  ex_other   uuid;
  before_ts  timestamptz;
  after_ts   timestamptz;
  locked_now boolean;
  pub_at     timestamptz;
  r text;
BEGIN
  INSERT INTO public.classes (school_id, name, section, academic_year)
  VALUES (sch_a, 'probe20 untaught', 'Z', to_char(now(),'YYYY'))
  RETURNING id INTO cls_other;

  INSERT INTO public.exams (school_id, class_id, name, exam_type, exam_date, max_marks, status)
  VALUES (sch_a, cls_taught, 'probe20 mine', 'unit_test', current_date, 100, 'scheduled')
  RETURNING id, updated_at INTO ex_mine, before_ts;
  INSERT INTO public.exams (school_id, class_id, name, exam_type, exam_date, max_marks, status)
  VALUES (sch_a, cls_other, 'probe20 not mine', 'unit_test', current_date, 100, 'scheduled')
  RETURNING id INTO ex_other;

  -- ── 1. FINALISE: the exact write setExamLocked issues ──────────────────
  -- The caller supplies an absurd past timestamp deliberately. `now()` is the
  -- TRANSACTION timestamp, so inside this probe it never advances -- comparing
  -- before/after would compare a value to itself and pass whether or not the
  -- trigger exists. Overriding a caller-supplied value is the claim that can
  -- actually fail: with no trigger the row would keep 2000-01-01.
  r := pg_temp.as_user(t1, format(
        'UPDATE public.exams SET marks_locked = true, updated_at = %L::timestamptz '
        'WHERE id = %L::uuid AND school_id = %L::uuid RETURNING id::text',
        '2000-01-01 00:00:00+00', ex_mine, sch_a));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('finalise a sitting of a class I teach (writes updated_at)','teacher (class teacher of 10 A)',
     'OK: a uuid, not PGRST204/42703', r,
     CASE WHEN r LIKE 'OK:%' AND r !~ 'updated_at' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 2. the trigger owns the column (positive control) ──────────────────
  SELECT updated_at, marks_locked INTO after_ts, locked_now
    FROM public.exams WHERE id = ex_mine;
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('exams_set_updated overrides a caller-supplied updated_at (positive control)','-',
     'not 2000-01-01', coalesce(after_ts::text,'null'),
     CASE WHEN after_ts IS NOT NULL AND after_ts > timestamptz '2001-01-01'
          THEN 'PASS' ELSE 'FAIL' END);

  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('the sitting really locked (positive control)','-','true',
     coalesce(locked_now::text,'null'),
     CASE WHEN locked_now THEN 'PASS' ELSE 'FAIL' END);

  -- ── 3/4. PUBLISH: the exact write setExamResultsPublished issues ───────
  r := pg_temp.as_user(t1, format(
        'UPDATE public.exams SET results_published_at = now(), updated_at = now() '
        'WHERE id = %L::uuid AND school_id = %L::uuid RETURNING id::text', ex_mine, sch_a));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('publish results (writes results_published_at + updated_at)','teacher (class teacher)',
     'OK: a uuid', r,
     CASE WHEN r LIKE 'OK:%' THEN 'PASS' ELSE 'FAIL' END);

  SELECT results_published_at INTO pub_at FROM public.exams WHERE id = ex_mine;
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('results_published_at really landed (positive control)','-','not null',
     coalesce(pub_at::text,'null'),
     CASE WHEN pub_at IS NOT NULL THEN 'PASS' ELSE 'FAIL' END);

  -- ── 5/6. the fence on a class I do not teach ───────────────────────────
  r := pg_temp.as_user(t1, format(
        'WITH u AS (UPDATE public.exams SET marks_locked = true, updated_at = now() '
        'WHERE id = %L::uuid AND school_id = %L::uuid RETURNING id) '
        'SELECT count(*)::text FROM u', ex_other, sch_a));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('finalise a sitting of a class I do NOT teach','teacher','OK: 0 rows updated', r,
     CASE WHEN r = 'OK: 0' THEN 'PASS' ELSE 'FAIL' END);

  SELECT marks_locked INTO locked_now FROM public.exams WHERE id = ex_other;
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('...and that sitting is still unlocked','-','false',
     coalesce(locked_now::text,'null'),
     CASE WHEN locked_now IS NOT TRUE THEN 'PASS' ELSE 'FAIL' END);
END $probe$;

SELECT area, role_tested, expected, observed, verdict FROM probe ORDER BY n;
ROLLBACK;
