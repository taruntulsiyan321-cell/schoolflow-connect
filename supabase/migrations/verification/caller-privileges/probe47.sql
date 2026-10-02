-- probe47: AI Practice's doors (20261138000000), asked as the people at them.
--
-- The ai-practice function writes a student's request log and reaches the bank
-- through three server-only functions; the question-explanations job claims
-- questions through a fourth. None of those is a student's to call, and a
-- student's request log is theirs alone.
--
-- THE CLAIMS
--   1. a student reads their OWN request log.                     (POSITIVE CONTROL)
--   2. another student reads none of it.                                 <- the fence
--   3. a student cannot write a request row, not even their own.         <- the grant
--   4. signed out, the log cannot be read.                               <- the grant
--   5. a student cannot store a generated question, claim explanations,
--      or ask for bank candidates — each refused for want of EXECUTE.    <- the doors
--   6. a student CAN check whether an explanation is proper (a pure
--      function the trigger uses).                              (POSITIVE CONTROL)
--
-- Every write is rolled back.
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
  a uuid; b uuid; r text;
BEGIN
  SELECT ms.account_id INTO a FROM public.memberships ms
    JOIN public.schools s ON s.id = ms.school_id AND s.kind = 'individual'
   ORDER BY ms.account_id LIMIT 1;
  SELECT ms.account_id INTO b FROM public.memberships ms
    JOIN public.schools s ON s.id = ms.school_id AND s.kind = 'individual'
   WHERE ms.account_id <> a ORDER BY ms.account_id LIMIT 1;
  IF a IS NULL OR b IS NULL THEN
    INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
      ('fixture: two exam accounts','-','two','not found','FAIL');
    RETURN;
  END IF;

  INSERT INTO public.ai_practice_requests (user_id, prompt, requested, status) VALUES (a, 'probe47 request', 5, 'ready');

  -- 1.
  r := pg_temp.as_user(a, $q$SELECT count(*)::text FROM public.ai_practice_requests WHERE prompt = 'probe47 request'$q$);
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('reads their own AI Practice request (positive control)','student (owner)','OK: 1', r, CASE WHEN r = 'OK: 1' THEN 'PASS' ELSE 'FAIL' END);
  -- 2.
  r := pg_temp.as_user(b, $q$SELECT count(*)::text FROM public.ai_practice_requests WHERE prompt = 'probe47 request'$q$);
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('reads another student''s AI Practice request','another student','OK: 0', r, CASE WHEN r = 'OK: 0' THEN 'PASS' ELSE 'FAIL' END);
  -- 3.
  r := pg_temp.as_user(a, $q$INSERT INTO public.ai_practice_requests (prompt, requested, status) VALUES ('forged', 5, 'ready') RETURNING 'written'$q$);
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('writes a request row of their own','student (owner)','ERROR: permission denied', r,
     CASE WHEN r LIKE 'ERROR:%permission denied%' THEN 'PASS' ELSE 'FAIL' END);
  -- 4.
  r := pg_temp.as_anon($q$SELECT count(*)::text FROM public.ai_practice_requests$q$);
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('reads AI Practice requests signed out','anon','ERROR: permission denied', r,
     CASE WHEN r LIKE 'ERROR:%permission denied%' THEN 'PASS' ELSE 'FAIL' END);
  -- 5.
  r := pg_temp.as_user(a, $q$SELECT public.store_generated_questions('[]'::jsonb)::text$q$);
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('stores a generated question in the shared bank','student','ERROR: permission denied', r,
     CASE WHEN r LIKE 'ERROR:%permission denied for function store_generated_questions%' THEN 'PASS' ELSE 'FAIL' END);
  r := pg_temp.as_user(a, $q$SELECT count(*)::text FROM public.claim_explanation_rewrites(1)$q$);
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('claims questions for the explanation rewrite','student','ERROR: permission denied', r,
     CASE WHEN r LIKE 'ERROR:%permission denied for function claim_explanation_rewrites%' THEN 'PASS' ELSE 'FAIL' END);
  r := pg_temp.as_user(a, format($q$SELECT count(*)::text FROM public.ai_practice_bank_candidates(%L, NULL, NULL, NULL, NULL, NULL, 5)$q$, b));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('asks for bank candidates in another student''s name','student','ERROR: permission denied', r,
     CASE WHEN r LIKE 'ERROR:%permission denied for function ai_practice_bank_candidates%' THEN 'PASS' ELSE 'FAIL' END);
  -- 6.
  r := pg_temp.as_user(a, $q$SELECT public.explanation_is_proper('Answer (a) — from chapter answer key.', 0, 4)::text$q$);
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('checks an explanation against the rule (positive control)','student','OK: false', r,
     CASE WHEN r = 'OK: false' THEN 'PASS' ELSE 'FAIL' END);
END $probe$;

SELECT area, role_tested, expected, observed, verdict FROM probe ORDER BY n;
ROLLBACK;
