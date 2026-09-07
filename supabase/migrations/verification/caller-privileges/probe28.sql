-- probe28: the two buckets that stopped being public, as the caller.
--
-- `storage.objects` is the only table in this project whose SELECT policy was
-- effectively `true`, and both buckets were additionally `public = true` —
-- URL-enumerable with no token at all. 20260914000000 closed both. Signing a
-- URL goes through the same SELECT policy these assertions exercise, so a
-- caller who cannot see the row cannot sign it either.
--
-- THE CLAIMS
--   1. the probe's teacher session is genuinely authenticated.  (harness control)
--
--   academic-files — the fence goes through the UPLOADER'S profile, because the
--   object key is `{auth.uid}/{file}` with no school segment.
--   2. a caller in the uploader's school reads the object.       (positive control)
--   3. a caller in ANOTHER school does not.                       <- the fence
--   4. a school-less caller does not.
--
--   doubt-images — the fence asks the ROW's question, not `owner = auth.uid()`.
--   The drafted policy was owner-only, which would have hidden every doubt
--   picture from the classmates and subject teacher the portal exists for.
--   5. the child who uploaded it reads it.                        (positive control)
--   6. a CLASSMATE reads it.                          <- what owner-only broke
--   7. the SUBJECT TEACHER of that class reads it.               (positive control)
--   8. a student in a DIFFERENT class does not.                   <- the fence
--   9. a caller in another school does not.
--
-- Claim 1 exists because 3, 4, 8 and 9 are denials: a probe whose session was
-- never established would score four passes for the wrong reason.
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
  t1       uuid := 'd1000002-0001-4000-8000-000000000001';  -- teacher of 10-A, school A
  sup      uuid := 'd1000005-0001-4000-8000-000000000001';  -- super admin, no school
  cls_a    uuid := 'd2000001-0001-4000-8000-000000000001';  -- 10-A, school A
  sch_a    uuid := '00000000-0000-4000-8000-000000000001';
  asker    uuid;   -- a 10-A student, the one who "uploaded"
  mate     uuid;   -- another 10-A student
  outsider uuid;   -- a student in a different class
  subj     text;   -- a subject t1 actually teaches for 10-A
  acad_obj text;
  doubt_obj text;
  doubt_id uuid;
  r        text;
BEGIN
  SELECT s.user_id INTO asker FROM public.students s
   WHERE s.class_id = cls_a AND s.user_id IS NOT NULL ORDER BY s.user_id LIMIT 1;
  SELECT s.user_id INTO mate FROM public.students s
   WHERE s.class_id = cls_a AND s.user_id IS NOT NULL AND s.user_id <> asker
   ORDER BY s.user_id LIMIT 1;
  SELECT s.user_id INTO outsider FROM public.students s
   WHERE s.class_id <> cls_a AND s.user_id IS NOT NULL ORDER BY s.user_id LIMIT 1;
  SELECT tc.subject INTO subj FROM public.teacher_classes tc
    JOIN public.teachers t ON t.id = tc.teacher_id
   WHERE tc.class_id = cls_a AND t.user_id = t1
     AND NULLIF(trim(coalesce(tc.subject,'')), '') IS NOT NULL
   LIMIT 1;
  IF asker IS NULL OR mate IS NULL OR outsider IS NULL OR subj IS NULL THEN
    RAISE EXCEPTION 'probe28: need two 10-A students, one outsider, and a subject t1 teaches (got %, %, %, %)',
      asker, mate, outsider, subj;
  END IF;

  -- ── fixtures ────────────────────────────────────────────────────────────
  acad_obj  := t1::text  || '/probe28-resource.pdf';
  doubt_obj := asker::text || '/probe28-doubt.png';

  INSERT INTO storage.objects (bucket_id, name, owner, owner_id)
  VALUES ('academic-files', acad_obj, t1, t1::text);
  INSERT INTO storage.objects (bucket_id, name, owner, owner_id)
  VALUES ('doubt-images', doubt_obj, asker, asker::text);

  INSERT INTO public.community_doubts
    (user_id, class_id, student_name, class_label, subject, title, body, image_url, school_id)
  VALUES
    (asker, cls_a, 'probe28 asker', '10-A', subj, 'probe28', 'probe28 body',
     'doubt-images/' || doubt_obj, sch_a)
  RETURNING id INTO doubt_id;

  -- ── 1. the session is real ──────────────────────────────────────────────
  r := pg_temp.as_user(t1, 'SELECT public.get_my_role()::text');
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('the probe session is genuinely authenticated (control)','teacher','OK: teacher', r,
     CASE WHEN r = 'OK: teacher' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 2-4. academic-files ─────────────────────────────────────────────────
  r := pg_temp.as_user(mate, format(
        'SELECT count(*)::text FROM storage.objects WHERE bucket_id = ''academic-files'' AND name = %L', acad_obj));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('academic-files: read a file uploaded in my school (positive control)','student, school A','OK: 1', r,
     CASE WHEN r = 'OK: 1' THEN 'PASS' ELSE 'FAIL' END);

  r := pg_temp.as_user(outsider, format(
        'SELECT count(*)::text FROM storage.objects WHERE bucket_id = ''academic-files'' AND name = %L', acad_obj));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('academic-files: read another SCHOOL''s file','student, school B','OK: 0', r,
     CASE WHEN r = 'OK: 0' THEN 'PASS' ELSE 'FAIL' END);

  r := pg_temp.as_user(sup, format(
        'SELECT count(*)::text FROM storage.objects WHERE bucket_id = ''academic-files'' AND name = %L', acad_obj));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('academic-files: read with no school at all','super_admin (no grant)','OK: 0', r,
     CASE WHEN r = 'OK: 0' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 5-9. doubt-images ───────────────────────────────────────────────────
  r := pg_temp.as_user(asker, format(
        'SELECT count(*)::text FROM storage.objects WHERE bucket_id = ''doubt-images'' AND name = %L', doubt_obj));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('doubt-images: read the picture I posted (positive control)','the asker','OK: 1', r,
     CASE WHEN r = 'OK: 1' THEN 'PASS' ELSE 'FAIL' END);

  r := pg_temp.as_user(mate, format(
        'SELECT count(*)::text FROM storage.objects WHERE bucket_id = ''doubt-images'' AND name = %L', doubt_obj));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('doubt-images: a CLASSMATE can see the doubt picture','classmate in 10-A','OK: 1', r,
     CASE WHEN r = 'OK: 1' THEN 'PASS' ELSE 'FAIL' END);

  r := pg_temp.as_user(t1, format(
        'SELECT count(*)::text FROM storage.objects WHERE bucket_id = ''doubt-images'' AND name = %L', doubt_obj));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('doubt-images: the SUBJECT TEACHER can see it (positive control)','teacher of 10-A','OK: 1', r,
     CASE WHEN r = 'OK: 1' THEN 'PASS' ELSE 'FAIL' END);

  r := pg_temp.as_user(outsider, format(
        'SELECT count(*)::text FROM storage.objects WHERE bucket_id = ''doubt-images'' AND name = %L', doubt_obj));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('doubt-images: a student outside the class','student, other class/school','OK: 0', r,
     CASE WHEN r = 'OK: 0' THEN 'PASS' ELSE 'FAIL' END);

  r := pg_temp.as_user(sup, format(
        'SELECT count(*)::text FROM storage.objects WHERE bucket_id = ''doubt-images'' AND name = %L', doubt_obj));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('doubt-images: read with no school at all','super_admin (no grant)','OK: 0', r,
     CASE WHEN r = 'OK: 0' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 10. and neither bucket is public any more ───────────────────────────
  INSERT INTO probe(area,role_tested,expected,observed,verdict)
  SELECT 'no bucket in the project is public', '-', '0 public',
         count(*)::text || ' public',
         CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END
    FROM storage.buckets WHERE public;
END $probe$;

SELECT area, role_tested, expected, observed, verdict FROM probe ORDER BY n;
ROLLBACK;
