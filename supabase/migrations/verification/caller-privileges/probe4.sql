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
  princ_a uuid := 'd1000001-0002-4000-8000-000000000002';
  teach_a uuid := 'd1000002-0001-4000-8000-000000000001';
  stud_a  uuid := 'd1000003-0001-4000-8000-000000000001';
  par_a   uuid := 'd1000004-0001-4000-8000-000000000001';
  sch_a   uuid := '00000000-0000-4000-8000-000000000001';
  sch_b   uuid := '00000000-0000-4000-8000-000000000002';
  vic_a uuid; vic_b uuid; aud_id uuid; cls_a uuid; r text;
BEGIN
  SELECT tc.class_id INTO cls_a FROM public.teacher_classes tc
    JOIN public.teachers t ON t.id = tc.teacher_id
   WHERE t.user_id = teach_a AND tc.class_id IS NOT NULL LIMIT 1;
  r := pg_temp.as_user(par_a, 'SELECT (public.rpc_parent_weekly_digest() ? ''children'')::text');
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('120000 digest','parent','OK: true',r, CASE WHEN r='OK: true' THEN 'PASS' ELSE 'FAIL' END);
  r := pg_temp.as_user(stud_a, 'SELECT (public.rpc_parent_weekly_digest() ? ''children'')::text');
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('120000 digest','student','ERROR Parent only',r, CASE WHEN r LIKE 'ERROR%Parent only%' THEN 'PASS' ELSE 'FAIL' END);
  r := pg_temp.as_user(teach_a, 'SELECT (public.rpc_parent_weekly_digest() ? ''children'')::text');
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('120000 digest','teacher','ERROR Parent only',r, CASE WHEN r LIKE 'ERROR%Parent only%' THEN 'PASS' ELSE 'FAIL' END);
  r := pg_temp.as_user(teach_a, format('WITH ins AS (INSERT INTO public.learning_resources (school_id,class_id,title,resource_type,created_by) VALUES (%L,%L,''probe'',''pdf'',%L) RETURNING 1) SELECT count(*)::text FROM ins', sch_a, cls_a, teach_a));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('140000 resources insert (positive control)','teacher who teaches the class','OK: 1 - 10.11 teachers upload',r, CASE WHEN r='OK: 1' THEN 'PASS' ELSE 'FAIL' END);
  r := pg_temp.as_user(admin_a, format('WITH ins AS (INSERT INTO public.learning_resources (school_id,class_id,title,resource_type,created_by) VALUES (%L,%L,''probe'',''pdf'',%L) RETURNING 1) SELECT count(*)::text FROM ins', sch_a, cls_a, admin_a));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('140000 resources insert','admin','ERROR row-level security - 10.11 teachers only',r, CASE WHEN r LIKE 'ERROR%row-level security%' OR r LIKE 'ERROR%violates%' THEN 'PASS' ELSE 'FAIL' END);
  r := pg_temp.as_user(stud_a, format('WITH ins AS (INSERT INTO public.learning_resources (school_id,class_id,title,resource_type,created_by) VALUES (%L,%L,''probe'',''pdf'',%L) RETURNING 1) SELECT count(*)::text FROM ins', sch_a, cls_a, stud_a));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('140000 resources insert','student','ERROR row-level security - 10.11 teachers only',r, CASE WHEN r LIKE 'ERROR%row-level security%' OR r LIKE 'ERROR%violates%' THEN 'PASS' ELSE 'FAIL' END);
  r := pg_temp.as_user(par_a, format('WITH ins AS (INSERT INTO public.learning_resources (school_id,class_id,title,resource_type,created_by) VALUES (%L,%L,''probe'',''pdf'',%L) RETURNING 1) SELECT count(*)::text FROM ins', sch_a, cls_a, par_a));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('140000 resources insert','parent','ERROR row-level security - 10.11 teachers only',r, CASE WHEN r LIKE 'ERROR%row-level security%' OR r LIKE 'ERROR%violates%' THEN 'PASS' ELSE 'FAIL' END);
  r := pg_temp.as_user(par_a, format('WITH ins AS (INSERT INTO public.school_complaints (school_id,submitted_by,complainant_name,subject,body) VALUES (%L,%L,''probe'',''s'',''b'') RETURNING 1) SELECT count(*)::text FROM ins', sch_a, par_a));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('0903 complaint insert (positive control)','parent','OK: 1 - 10.15 parent may raise',r, CASE WHEN r='OK: 1' THEN 'PASS' ELSE 'FAIL' END);
  r := pg_temp.as_user(teach_a, format('WITH ins AS (INSERT INTO public.school_complaints (school_id,submitted_by,complainant_name,subject,body) VALUES (%L,%L,''probe'',''s'',''b'') RETURNING 1) SELECT count(*)::text FROM ins', sch_a, teach_a));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('0903 complaint insert','teacher','ERROR row-level security - spec forbids',r, CASE WHEN r LIKE 'ERROR%row-level security%' OR r LIKE 'ERROR%violates%' THEN 'PASS' ELSE 'FAIL' END);
  r := pg_temp.as_user(stud_a, format('WITH ins AS (INSERT INTO public.school_complaints (school_id,submitted_by,complainant_name,subject,body) VALUES (%L,%L,''probe'',''s'',''b'') RETURNING 1) SELECT count(*)::text FROM ins', sch_a, stud_a));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('0903 complaint insert','student','ERROR row-level security - spec forbids',r, CASE WHEN r LIKE 'ERROR%row-level security%' OR r LIKE 'ERROR%violates%' THEN 'PASS' ELSE 'FAIL' END);
END
$probe$;
SELECT n, area, role_tested, verdict, expected, observed FROM probe ORDER BY n;
ROLLBACK;
