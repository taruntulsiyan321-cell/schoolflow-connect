-- probe50: the paper, as the analysis reads it (20261144000000), asked as the people at it.
--
-- rpc_exam_paper() hands a signed-in student _mock_paper()'s numbers; it reads
-- no table. _mock_paper() itself stays shut.
--
-- THE CLAIMS
--   1. a student reads the paper, and it is _mock_paper()'s.   (POSITIVE CONTROL)
--   2. signed out, it cannot be called.                         <- the grant
--   3. with no identity, it refuses.                            <- the rule
--   4. a student still cannot call _mock_paper() itself.        <- the door is to its numbers only
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
  a uuid; r text;
BEGIN
  SELECT st.user_id INTO a
    FROM public.students st JOIN public.schools s ON s.id = st.school_id AND s.kind = 'individual'
   WHERE st.user_id IS NOT NULL ORDER BY st.user_id LIMIT 1;
  IF a IS NULL THEN
    INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
      ('fixture: an individual student','-','found','not found','FAIL');
    RETURN;
  END IF;
  -- 1.
  r := pg_temp.as_user(a, $q$SELECT (p->>'questions') || '/' || (p->>'minutes') || '/' || (p->>'marks_correct') || '/' || (p->>'marks_wrong') FROM (SELECT public.rpc_exam_paper() AS p) x$q$);
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('reads the paper (positive control)','student',
     'OK: ' || (public._mock_paper()->>'questions') || '/' || (public._mock_paper()->>'minutes') || '/' || (public._mock_paper()->>'marks_correct') || '/' || (public._mock_paper()->>'marks_wrong'), r,
     CASE WHEN r = 'OK: ' || (public._mock_paper()->>'questions') || '/' || (public._mock_paper()->>'minutes') || '/' || (public._mock_paper()->>'marks_correct') || '/' || (public._mock_paper()->>'marks_wrong') THEN 'PASS' ELSE 'FAIL' END);
  -- 2.
  r := pg_temp.as_anon($q$SELECT public.rpc_exam_paper()::text$q$);
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('reads the paper signed out','anon','ERROR: permission denied for function', r,
     CASE WHEN r LIKE 'ERROR:%permission denied for function rpc_exam_paper%' THEN 'PASS' ELSE 'FAIL' END);
  -- 3.
  r := pg_temp.as_user(NULL, $q$SELECT public.rpc_exam_paper()::text$q$);
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('reads the paper with no identity','authenticated, no sub','ERROR: auth required', r,
     CASE WHEN r = 'ERROR: auth required' THEN 'PASS' ELSE 'FAIL' END);
  -- 4.
  r := pg_temp.as_user(a, $q$SELECT public._mock_paper()::text$q$);
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('calls _mock_paper() itself','student','ERROR: permission denied for function', r,
     CASE WHEN r LIKE 'ERROR:%permission denied for function _mock_paper%' THEN 'PASS' ELSE 'FAIL' END);
END $probe$;

SELECT area, role_tested, expected, observed, verdict FROM probe ORDER BY n;
ROLLBACK;
