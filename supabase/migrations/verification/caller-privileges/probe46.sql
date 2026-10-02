-- probe46: a student's marks and voice notes are theirs alone (20261137000000).
--
-- A mark says why a student thinks they got a question wrong — tags, a note,
-- a recording of their own voice. Nobody else reads it: not another student,
-- not anyone signed out. The voice notes live in a private bucket, one folder
-- per account.
--
-- THE CLAIMS
--   1. a student writes and reads their OWN mark.               (POSITIVE CONTROL)
--   2. another student cannot read it.                                 <- the fence
--   3. another student cannot change it.                               <- the fence
--   4. another student cannot write a mark in the first one's name.    <- the check
--   5. another student marks the same question for THEMSELF, and sees
--      exactly one mark: their own.                            (POSITIVE CONTROL)
--   6. signed out, neither marks nor tags can be read.                 <- the grant
--   7. a student reads the tags.                                (POSITIVE CONTROL)
--   8. a recording is readable by its owner only, and no student can
--      put one in another student's folder.                    <- the bucket fence
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
  a uuid; b uuid; q uuid;
  r text;
BEGIN
  -- Two individual exam accounts; A has a practice mistake on a bank question.
  SELECT m.user_id, m.question_id INTO a, q
    FROM public.student_mistakes m
    JOIN public.memberships ms ON ms.account_id = m.user_id
    JOIN public.schools s ON s.id = ms.school_id AND s.kind = 'individual'
   WHERE m.source = 'practice' AND m.question_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.question_bank qb WHERE qb.id = m.question_id)
   ORDER BY m.last_wrong_at DESC, m.id LIMIT 1;
  SELECT ms.account_id INTO b
    FROM public.memberships ms
    JOIN public.schools s ON s.id = ms.school_id AND s.kind = 'individual'
   WHERE ms.account_id <> a
   ORDER BY ms.account_id LIMIT 1;
  IF a IS NULL OR b IS NULL THEN
    INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
      ('fixture: two exam accounts, one with a bank mistake','-','two','not found','FAIL');
    RETURN;
  END IF;

  -- 1.
  r := pg_temp.as_user(a, format(
    $q$INSERT INTO public.question_marks (bank_question_id, question_text, tags, note)
       VALUES (%L, 'probe question', ARRAY['recall'], 'probe note') RETURNING note$q$, q));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('marks a question (positive control)','student (owner)','OK: probe note', r,
     CASE WHEN r = 'OK: probe note' THEN 'PASS' ELSE 'FAIL' END);
  r := pg_temp.as_user(a, format($q$SELECT count(*)::text FROM public.question_marks WHERE question_ref = %L$q$, q));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('reads their own mark (positive control)','student (owner)','OK: 1', r, CASE WHEN r = 'OK: 1' THEN 'PASS' ELSE 'FAIL' END);

  -- 2.
  r := pg_temp.as_user(b, format($q$SELECT count(*)::text FROM public.question_marks WHERE user_id = %L$q$, a));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('reads another student''s marks','another student','OK: 0', r, CASE WHEN r = 'OK: 0' THEN 'PASS' ELSE 'FAIL' END);

  -- 3.
  r := pg_temp.as_user(b, format(
    $q$WITH u AS (UPDATE public.question_marks SET note = 'not yours' WHERE user_id = %L RETURNING 1) SELECT count(*)::text FROM u$q$, a));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('changes another student''s mark','another student','OK: 0', r, CASE WHEN r = 'OK: 0' THEN 'PASS' ELSE 'FAIL' END);

  -- 4.
  r := pg_temp.as_user(b, format(
    $q$INSERT INTO public.question_marks (user_id, bank_question_id, question_text, tags)
       VALUES (%L, %L, 'x', ARRAY['recall']) RETURNING 'written'$q$, a, q));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('writes a mark in another student''s name','another student','ERROR: row-level security', r,
     CASE WHEN r LIKE 'ERROR:%row-level security%' THEN 'PASS' ELSE 'FAIL' END);

  -- 5.
  r := pg_temp.as_user(b, format(
    $q$WITH i AS (INSERT INTO public.question_marks (bank_question_id, question_text, tags) VALUES (%L, 'x', ARRAY['guessed']) RETURNING 1)
       SELECT count(*)::text FROM i$q$, q));
  r := r || ' / ' || pg_temp.as_user(b, format($q$SELECT string_agg(tags::text, ',') FROM public.question_marks WHERE question_ref = %L$q$, q));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('marks the same question for themself, and sees only that (positive control)','another student',
     'OK: 1 / OK: {guessed}', r, CASE WHEN r = 'OK: 1 / OK: {guessed}' THEN 'PASS' ELSE 'FAIL' END);

  -- 6.
  r := pg_temp.as_anon('SELECT count(*)::text FROM public.question_marks');
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('reads marks signed out','anon','ERROR: permission denied', r, CASE WHEN r LIKE 'ERROR:%permission denied%' THEN 'PASS' ELSE 'FAIL' END);
  r := pg_temp.as_anon('SELECT count(*)::text FROM public.mark_tags');
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('reads the tags signed out','anon','ERROR: permission denied', r, CASE WHEN r LIKE 'ERROR:%permission denied%' THEN 'PASS' ELSE 'FAIL' END);

  -- 7.
  r := pg_temp.as_user(a, 'SELECT (count(*) > 0)::text FROM public.mark_tags WHERE active');
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('reads the tags (positive control)','student','OK: true', r, CASE WHEN r = 'OK: true' THEN 'PASS' ELSE 'FAIL' END);

  -- 8.
  r := pg_temp.as_user(a, format(
    $q$INSERT INTO storage.objects (bucket_id, name) VALUES ('question-voice-notes', %L) RETURNING 'stored'$q$, a::text || '/probe46.webm'));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('keeps a recording in their own folder (positive control)','student (owner)','OK: stored', r,
     CASE WHEN r = 'OK: stored' THEN 'PASS' ELSE 'FAIL' END);
  r := pg_temp.as_user(a, format(
    $q$SELECT count(*)::text FROM storage.objects WHERE bucket_id = 'question-voice-notes' AND name = %L$q$, a::text || '/probe46.webm'));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('reads their own recording (positive control)','student (owner)','OK: 1', r, CASE WHEN r = 'OK: 1' THEN 'PASS' ELSE 'FAIL' END);
  r := pg_temp.as_user(b, format(
    $q$SELECT count(*)::text FROM storage.objects WHERE bucket_id = 'question-voice-notes' AND name = %L$q$, a::text || '/probe46.webm'));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('reads another student''s recording','another student','OK: 0', r, CASE WHEN r = 'OK: 0' THEN 'PASS' ELSE 'FAIL' END);
  r := pg_temp.as_user(b, format(
    $q$INSERT INTO storage.objects (bucket_id, name) VALUES ('question-voice-notes', %L) RETURNING 'stored'$q$, a::text || '/planted.webm'));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('puts a recording in another student''s folder','another student','ERROR: row-level security', r,
     CASE WHEN r LIKE 'ERROR:%row-level security%' THEN 'PASS' ELSE 'FAIL' END);
END $probe$;

SELECT area, role_tested, expected, observed, verdict FROM probe ORDER BY n;
ROLLBACK;
