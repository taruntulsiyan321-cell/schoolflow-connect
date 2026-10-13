-- probe52: nobody writes through a view (20261159000000), asked as the people at it.
--
-- question_bank_student runs with its owner's rights and is automatically
-- updatable, so a write privilege on it was a write to the whole question bank
-- past RLS. Supabase's default privileges grant every new object to anon and
-- authenticated, so a view created later arrives with them: claim 4 catches it.
--
-- THE CLAIMS
--   1. a student reads the bank through the view.                          (POSITIVE CONTROL)
--   2. a student cannot update, delete or insert through it.               <- the grant
--   3. signed out, it cannot be read.                                      <- the grant
--   4. no client role holds a write privilege on any public view.          <- the rule, for views to come
BEGIN;
SET LOCAL statement_timeout = '120s';
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
    RETURN 'ERROR ' || SQLSTATE || ': ' || SQLERRM;
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
    RETURN 'ERROR ' || SQLSTATE || ': ' || SQLERRM;
  END;
END $fn$;

DO $probe$
DECLARE
  a uuid; q uuid; r text; n int;
BEGIN
  SELECT ea.account_id INTO a FROM public.exam_accounts ea ORDER BY ea.account_id LIMIT 1;
  IF a IS NULL THEN
    INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
      ('fixture: an exam account','-','found','not found','FAIL');
    RETURN;
  END IF;

  -- 1. POSITIVE CONTROL: the student reads the bank, and finds a question to aim at.
  r := pg_temp.as_user(a, 'SELECT count(*)::text FROM public.question_bank_student');
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('question_bank_student: read', 'student', 'OK: >= 100 rows', r,
     CASE WHEN r LIKE 'OK: %' AND substring(r FROM 5)::int >= 100 THEN 'PASS' ELSE 'FAIL' END);
  r := pg_temp.as_user(a, 'SELECT id::text FROM public.question_bank_student ORDER BY id LIMIT 1');
  q := CASE WHEN r LIKE 'OK: %' AND r <> 'OK: null' THEN substring(r FROM 5)::uuid END;

  -- 2. the three writes, each refused for want of privilege (42501) — a
  --    constraint error would mean the privilege let it through.
  r := pg_temp.as_user(a, format('UPDATE public.question_bank_student SET question = question WHERE id = %L RETURNING id::text', q));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('question_bank_student: update', 'student', 'ERROR 42501', left(r, 70), CASE WHEN q IS NOT NULL AND r LIKE 'ERROR 42501%' THEN 'PASS' ELSE 'FAIL' END);
  r := pg_temp.as_user(a, format('DELETE FROM public.question_bank_student WHERE id = %L RETURNING id::text', q));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('question_bank_student: delete', 'student', 'ERROR 42501', left(r, 70), CASE WHEN q IS NOT NULL AND r LIKE 'ERROR 42501%' THEN 'PASS' ELSE 'FAIL' END);
  r := pg_temp.as_user(a, 'INSERT INTO public.question_bank_student (question) VALUES (''probe'') RETURNING id::text');
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('question_bank_student: insert', 'student', 'ERROR 42501', left(r, 70), CASE WHEN r LIKE 'ERROR 42501%' THEN 'PASS' ELSE 'FAIL' END);

  -- 3. signed out
  r := pg_temp.as_anon('SELECT count(*)::text FROM public.question_bank_student');
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('question_bank_student: read', 'anon', 'ERROR 42501', left(r, 70), CASE WHEN r LIKE 'ERROR 42501%' THEN 'PASS' ELSE 'FAIL' END);

  -- 4. every public view, every client role, every write privilege
  SELECT count(*) INTO n
    FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
         CROSS JOIN (VALUES ('anon'), ('authenticated')) rl(role)
         CROSS JOIN (VALUES ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) p(priv)
   WHERE ns.nspname = 'public' AND c.relkind IN ('v', 'm')
     AND has_table_privilege(rl.role, c.oid, p.priv);
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('every public view: client write privileges', 'anon + authenticated', '0', n::text, CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END);
END $probe$;

SELECT area, role_tested, expected, observed, verdict FROM probe ORDER BY n;
ROLLBACK;
