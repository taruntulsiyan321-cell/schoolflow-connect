-- probe9: the Resources upload path end to end, as the people who use it.
--
-- §10.11: uploaded by teachers only, only to classes they teach, targeted at a
-- specific class, deletable by the uploader, permanent deletion with no trash.
--
-- probe4 already covers "admin/student/parent are refused". This file covers
-- the parts the upload build depends on: the teacher round trip, the
-- teaches-this-class boundary, who can read the result, and uploader-only
-- delete.
--
-- Fixtures: Priya Sharma teaches 10-A, 9-A and 12-A. Rajesh Verma teaches ONLY
-- 10-A, which makes him the teacher who does not teach 12-A. Aarav Sharma is a
-- student of 12-A — same school, different class from the resource.
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
  priya  uuid := 'd1000002-0001-4000-8000-000000000001';  -- teaches 10-A, 9-A, 12-A
  rajesh uuid := 'd1000002-0002-4000-8000-000000000002';  -- teaches 10-A ONLY
  stud10 uuid := 'da000000-0001-4000-8000-000000000001';  -- QA Automation, 10-A
  stud12 uuid := 'd1000003-0012-4000-8000-000000000012';  -- Aarav Sharma, 12-A
  studB  uuid := '00eaf754-ccb5-4e3d-a393-da5ee2917821';  -- a student of school B
  cls10  uuid := 'd2000001-0001-4000-8000-000000000001';
  cls12  uuid := 'd2000001-0012-4000-8000-000000000012';
  sch_a  uuid := '00000000-0000-4000-8000-000000000001';
  res    uuid := 'c0ffee00-0009-4000-8000-000000000009';  -- the probe's resource row
  wide   uuid := 'c0ffee00-0010-4000-8000-000000000010';  -- a school-wide row (class_id NULL)
  par_a  uuid := 'd1000004-0001-4000-8000-000000000001';  -- parent of Arjun Mehta, 10-A
  r text; r2 text; n int;
BEGIN
  -- ---- upload: the teacher who teaches the class ----
  r := pg_temp.as_user(priya, format(
    $q$WITH ins AS (INSERT INTO public.learning_resources
        (id, school_id, class_id, title, resource_type, storage_path, created_by)
        VALUES (%L,%L,%L,'probe9 chapter notes','pdf','probe/notes.pdf',%L) RETURNING 1)
      SELECT count(*)::text FROM ins$q$, res, sch_a, cls10, priya));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('10.11 resource insert (positive control)','teacher who teaches the class','OK: 1',r,
     CASE WHEN r='OK: 1' THEN 'PASS' ELSE 'FAIL' END);

  -- ---- upload: a teacher, but not of THAT class (foundation-build-prompt 2187) ----
  r := pg_temp.as_user(rajesh, format(
    $q$WITH ins AS (INSERT INTO public.learning_resources
        (school_id, class_id, title, resource_type, storage_path, created_by)
        VALUES (%L,%L,'probe9 wrong class','pdf','probe/x.pdf',%L) RETURNING 1)
      SELECT count(*)::text FROM ins$q$, sch_a, cls12, rajesh));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('10.11 resource insert into a class he does NOT teach','teacher (teaches 10-A only)','ERROR row-level security',r,
     CASE WHEN r LIKE 'ERROR%row-level security%' OR r LIKE 'ERROR%violates%' THEN 'PASS' ELSE 'FAIL' END);

  -- Pair for the denial above: the SAME teacher into a class he DOES teach must
  -- succeed, or the refusal above would also pass on a typo (G11).
  r := pg_temp.as_user(rajesh, format(
    $q$WITH ins AS (INSERT INTO public.learning_resources
        (school_id, class_id, title, resource_type, storage_path, created_by)
        VALUES (%L,%L,'probe9 right class','pdf','probe/y.pdf',%L) RETURNING 1)
      SELECT count(*)::text FROM ins$q$, sch_a, cls10, rajesh));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('10.11 same teacher into a class he DOES teach (positive control)','teacher (teaches 10-A only)','OK: 1',r,
     CASE WHEN r='OK: 1' THEN 'PASS' ELSE 'FAIL' END);

  -- ---- read: the student the resource was aimed at ----
  r := pg_temp.as_user(stud10, format(
    $q$SELECT count(*)::text FROM public.learning_resources WHERE id = %L$q$, res));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('10.11 resource visible to a student of that class (positive control)','student of 10-A','OK: 1',r,
     CASE WHEN r='OK: 1' THEN 'PASS' ELSE 'FAIL' END);

  -- ---- read: a student of ANOTHER CLASS in the same school ----
  -- Ruled 2026-09-04 and closed by 20260905020000: "targeted at a specific
  -- class" now binds the READ as well as the upload. Before that migration this
  -- returned 1 — resources_select was same_school AND (is_published OR admin OR
  -- teacher), with no class predicate anywhere, and the only class scoping in
  -- the product lived in ResourceService.listForStudent's filter.
  r := pg_temp.as_user(stud12, format(
    $q$SELECT count(*)::text FROM public.learning_resources WHERE id = %L$q$, res));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('10.11 RLS confines a resource to its class','student of 12-A','OK: 0',r,
     CASE WHEN r='OK: 0' THEN 'PASS' ELSE 'FAIL' END);

  -- Pair for the denial above: a school-wide row (class_id IS NULL) must still
  -- reach that same student, or "0" above would also be produced by a policy
  -- that simply hid everything (G11).
  INSERT INTO public.learning_resources
    (id, school_id, class_id, title, resource_type, storage_path, created_by)
  VALUES (wide, sch_a, NULL, 'probe9 school-wide', 'pdf', 'probe/wide.pdf', priya);
  r := pg_temp.as_user(stud12, format(
    $q$SELECT count(*)::text FROM public.learning_resources WHERE id = %L$q$, wide));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('10.11 school-wide resource still reaches every student (positive control)','student of 12-A','OK: 1',r,
     CASE WHEN r='OK: 1' THEN 'PASS' ELSE 'FAIL' END);

  -- And a parent of a child in the target class must see it.
  r := pg_temp.as_user(par_a, format(
    $q$SELECT count(*)::text FROM public.learning_resources WHERE id = %L$q$, res));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('10.11 parent of a child in that class can read it','parent','OK: 1',r,
     CASE WHEN r='OK: 1' THEN 'PASS' ELSE 'FAIL' END);

  -- The filter ResourceService.listForStudent actually sends for that student:
  -- school + is_published + (class_id = mine OR class_id IS NULL).
  r := pg_temp.as_user(stud12, format(
    $q$SELECT count(*)::text FROM public.learning_resources
        WHERE id = %L AND school_id = %L AND is_published
          AND (class_id = %L OR class_id IS NULL)$q$, res, sch_a, cls12));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('10.11 ResourceService class filter DOES exclude the other class','student of 12-A','OK: 0',r,
     CASE WHEN r='OK: 0' THEN 'PASS' ELSE 'FAIL' END);

  -- ---- read: another school entirely ----
  r := pg_temp.as_user(studB, format(
    $q$SELECT count(*)::text FROM public.learning_resources WHERE id = %L$q$, res));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('10.11 resource invisible across schools','student of school B','OK: 0 - tenancy fence',r,
     CASE WHEN r='OK: 0' THEN 'PASS' ELSE 'FAIL' END);

  -- ---- delete: uploader only ----
  r := pg_temp.as_user(rajesh, format(
    $q$WITH del AS (DELETE FROM public.learning_resources WHERE id = %L RETURNING 1)
      SELECT count(*)::text FROM del$q$, res));
  SELECT count(*) INTO n FROM public.learning_resources WHERE id = res;
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('10.11 delete another teacher''s resource','teacher who did not upload it','refused AND row survives',
     format('%s / row still there: %s', r, n),
     CASE WHEN n = 1 AND (r='OK: 0' OR r LIKE 'ERROR%') THEN 'PASS' ELSE 'FAIL' END);

  r := pg_temp.as_user(priya, format(
    $q$WITH del AS (DELETE FROM public.learning_resources WHERE id = %L RETURNING 1)
      SELECT count(*)::text FROM del$q$, res));
  SELECT count(*) INTO n FROM public.learning_resources WHERE id = res;
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('10.11 uploader deletes their own resource (positive control)','teacher who uploaded it','OK: 1 AND row gone',
     format('%s / rows now: %s', r, n),
     CASE WHEN r='OK: 1' AND n = 0 THEN 'PASS' ELSE 'FAIL' END);

  -- ---- a resource orphaned by a deleted class is still the uploader's ----
  -- KNOWN_ISSUES 8: every write policy used to require class_id IS NOT NULL, so
  -- ON DELETE SET NULL left rows nobody could edit or remove.
  UPDATE public.learning_resources SET class_id = NULL WHERE id = wide;
  r := pg_temp.as_user(priya, format(
    $q$WITH del AS (DELETE FROM public.learning_resources WHERE id = %L RETURNING 1)
      SELECT count(*)::text FROM del$q$, wide));
  SELECT count(*) INTO n FROM public.learning_resources WHERE id = wide;
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('10.11 uploader can delete a resource orphaned by a deleted class','teacher who uploaded it','OK: 1 AND row gone',
     format('%s / rows now: %s', r, n),
     CASE WHEN r='OK: 1' AND n = 0 THEN 'PASS' ELSE 'FAIL' END);

  -- ---- and the delete is permanent: no trash entry ----
  SELECT count(*)::text INTO r2 FROM public.trash WHERE entity_type = 'learning_resource';
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('10.11 hard delete - resources never enter trash','-','OK: 0 rows in trash',
     format('OK: %s', r2),
     CASE WHEN r2 = '0' THEN 'PASS' ELSE 'FAIL' END);
END
$probe$;
SELECT n, area, role_tested, verdict, expected, observed FROM probe ORDER BY n;
ROLLBACK;
