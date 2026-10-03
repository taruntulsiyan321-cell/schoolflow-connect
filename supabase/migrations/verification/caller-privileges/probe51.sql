-- probe51: the syllabus map (20261145000000), asked as the people at it.
--
-- rpc_student_syllabus_map(window) is SECURITY DEFINER, so its fence is its
-- own body: the caller's exam, the caller's answers. The migration's proof
-- shows another student's answers are not counted; this asks the doors.
--
-- THE CLAIMS
--   1. a student with an exam reads their syllabus: every chapter of it.   (POSITIVE CONTROL)
--   2. signed out, it cannot be called.                                    <- the grant
--   3. with no identity, it refuses.                                       <- the rule
--   4. a window outside 1–90 days is refused.                              <- the rule
BEGIN;
SET LOCAL statement_timeout = '120s';
CREATE TEMP TABLE probe(n serial, area text, role_tested text, expected text, observed text, verdict text) ON COMMIT DROP;

CREATE FUNCTION pg_temp.as_user(_uid uuid, _sql text) RETURNS text
LANGUAGE plpgsql AS $fn$
DECLARE _out text;
BEGIN
  PERFORM set_config('request.jwt.claims', CASE WHEN _uid IS NULL THEN json_build_object('role','authenticated')::text
                                                ELSE json_build_object('sub',_uid,'role','authenticated')::text END, true);
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

CREATE FUNCTION pg_temp.as_anon(_sql text) RETURNS text
LANGUAGE plpgsql AS $fn$
DECLARE _out text;
BEGIN
  PERFORM set_config('request.jwt.claims', NULL, true);
  PERFORM set_config('role','anon', true);
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
  a uuid; n int; r text;
BEGIN
  SELECT ea.account_id, (SELECT count(*) FROM public.exam_syllabus_chapters esc WHERE esc.exam_id = ea.exam_id AND esc.stream = ea.stream)
    INTO a, n
    FROM public.exam_accounts ea JOIN public.students st ON st.user_id = ea.account_id
   ORDER BY ea.account_id LIMIT 1;
  IF a IS NULL OR n = 0 THEN
    INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
      ('fixture: a student with an exam and a syllabus','-','found','not found','FAIL');
    RETURN;
  END IF;
  -- 1.
  r := pg_temp.as_user(a, $q$SELECT jsonb_array_length(public.rpc_student_syllabus_map(14)->'chapters')::text$q$);
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('reads their syllabus, every chapter (positive control)','student','OK: ' || n, r,
     CASE WHEN r = 'OK: ' || n THEN 'PASS' ELSE 'FAIL' END);
  -- 2.
  r := pg_temp.as_anon($q$SELECT public.rpc_student_syllabus_map(14)::text$q$);
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('reads a syllabus map signed out','anon','ERROR: permission denied for function', r,
     CASE WHEN r LIKE 'ERROR:%permission denied for function rpc_student_syllabus_map%' THEN 'PASS' ELSE 'FAIL' END);
  -- 3.
  r := pg_temp.as_user(NULL, $q$SELECT public.rpc_student_syllabus_map(14)::text$q$);
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('reads a syllabus map with no identity','authenticated, no sub','ERROR: auth required', r,
     CASE WHEN r = 'ERROR: auth required' THEN 'PASS' ELSE 'FAIL' END);
  -- 4.
  r := pg_temp.as_user(a, $q$SELECT public.rpc_student_syllabus_map(365)::text$q$);
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('asks for a year as the recent window','student','ERROR: the recent window must be 1 to 90 days', r,
     CASE WHEN r = 'ERROR: the recent window must be 1 to 90 days' THEN 'PASS' ELSE 'FAIL' END);
END $probe$;

SELECT area, role_tested, expected, observed, verdict FROM probe ORDER BY n;
ROLLBACK;
