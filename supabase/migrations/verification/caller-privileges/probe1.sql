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
  SELECT id INTO vic_a FROM public.students WHERE school_id=sch_a AND deleted_at IS NULL LIMIT 1;
  SELECT id INTO vic_b FROM public.students WHERE school_id=sch_b AND deleted_at IS NULL LIMIT 1;
  UPDATE public.students SET deleted_at=now(), deleted_by=admin_a WHERE id IN (vic_a, vic_b);
  r := pg_temp.as_user(admin_a, format('SELECT public.rpc_restore_from_trash(%L,%L)::text','student',vic_b));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('160000 restore CROSS-TENANT','admin of school A','ERROR or false - must NOT restore school B',r, CASE WHEN r LIKE 'ERROR%' OR r='OK: false' THEN 'PASS' ELSE 'FAIL' END);
  r := pg_temp.as_user(admin_a, format('SELECT public.rpc_restore_from_trash(%L,%L)::text','student',vic_a));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('160000 restore own-tenant','admin of school A','OK: true - guard must not break the feature',r, CASE WHEN r='OK: true' THEN 'PASS' ELSE 'FAIL' END);
  UPDATE public.students SET deleted_at=now(), deleted_by=admin_a WHERE id=vic_a;
  r := pg_temp.as_user(teach_a, format('SELECT public.rpc_restore_from_trash(%L,%L)::text','student',vic_a));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('130000 restore role gate','teacher','ERROR Admin only',r, CASE WHEN r LIKE 'ERROR%Admin only%' THEN 'PASS' ELSE 'FAIL' END);
  r := pg_temp.as_user(par_a, format('SELECT public.rpc_restore_from_trash(%L,%L)::text','student',vic_a));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('130000 restore role gate','parent','ERROR Admin only',r, CASE WHEN r LIKE 'ERROR%Admin only%' THEN 'PASS' ELSE 'FAIL' END);
  r := pg_temp.as_user(stud_a, format('SELECT public.rpc_restore_from_trash(%L,%L)::text','student',vic_a));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('130000 restore role gate','student','ERROR Admin only',r, CASE WHEN r LIKE 'ERROR%Admin only%' THEN 'PASS' ELSE 'FAIL' END);
END
$probe$;
SELECT n, area, role_tested, verdict, expected, observed FROM probe ORDER BY n;
ROLLBACK;
