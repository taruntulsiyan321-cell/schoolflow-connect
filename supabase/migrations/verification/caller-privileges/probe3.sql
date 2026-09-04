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
  SELECT id INTO aud_id FROM public.academic_audit WHERE school_id=sch_a LIMIT 1;
  r := pg_temp.as_user(admin_a, format('SELECT count(*)::text FROM public.academic_audit WHERE id=%L', aud_id));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('100000 audit read (one school-A row)','admin of school A','OK: 1',r, CASE WHEN r='OK: 1' THEN 'PASS' ELSE 'FAIL' END);
  r := pg_temp.as_user(princ_a, format('SELECT count(*)::text FROM public.academic_audit WHERE id=%L', aud_id));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('100000 audit read (one school-A row)','PRINCIPAL','OK: 0 - 10.18 admin only',r, CASE WHEN r='OK: 0' THEN 'PASS' ELSE 'FAIL' END);
  r := pg_temp.as_user(teach_a, format('SELECT count(*)::text FROM public.academic_audit WHERE id=%L', aud_id));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('100000 audit read (one school-A row)','teacher','OK: 0 - 10.18 admin only',r, CASE WHEN r='OK: 0' THEN 'PASS' ELSE 'FAIL' END);
  r := pg_temp.as_user(par_a, format('SELECT count(*)::text FROM public.academic_audit WHERE id=%L', aud_id));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('100000 audit read (one school-A row)','parent','OK: 0 - 10.18 admin only',r, CASE WHEN r='OK: 0' THEN 'PASS' ELSE 'FAIL' END);
  r := pg_temp.as_user(stud_a, format('SELECT count(*)::text FROM public.academic_audit WHERE id=%L', aud_id));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('100000 audit read (one school-A row)','student','OK: 0 - 10.18 admin only',r, CASE WHEN r='OK: 0' THEN 'PASS' ELSE 'FAIL' END);
END
$probe$;
SELECT n, area, role_tested, verdict, expected, observed FROM probe ORDER BY n;
ROLLBACK;
