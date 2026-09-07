-- probe29: class_level follows the curriculum, as the caller.
--
-- 20260914020000 dropped `question_bank_class_level_check` (a hardcoded 6..12)
-- and replaced it with a trigger that makes `class_level` agree with the
-- chapter's curriculum class. §10.9 is what it enforces: "a Class 5 student is
-- only ever served Class 5 content for their own board."
--
-- THE CLAIMS
--   1. the probe's teacher session is genuinely authenticated. (harness control)
--   2. a CLASS 5 question can be saved at all.            <- the ruling applied
--   3. omitting class_level fills it from the chapter.    <- the derivation
--   4. a class that DISAGREES with the chapter is refused. <- the fence
--   5. an unkeyed ACTIVE question is still refused.     (untouched, positive
--      control that this migration did not loosen §10.10)
--   6. every Class 5 question is active and readable.        <- the rollout
--
-- Claim 1 matters because 4 and 5 are denials. Claim 5 matters because dropping
-- one constraint next to another is exactly how the second one goes missing.
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
  t1    uuid := 'd1000002-0001-4000-8000-000000000001';  -- teacher, school A
  ch5   uuid;   -- a Class 5 chapter
  ch12  uuid;   -- a Class 12 chapter
  q     text;
  r     text;
BEGIN
  SELECT ch.id INTO ch5
    FROM public.chapters ch
    JOIN public.curriculum_subjects cs ON cs.id = ch.curriculum_subject_id
    JOIN public.curriculum_classes  cc ON cc.id = cs.curriculum_class_id
   WHERE cc.level = 5 ORDER BY ch.id LIMIT 1;
  SELECT ch.id INTO ch12
    FROM public.chapters ch
    JOIN public.curriculum_subjects cs ON cs.id = ch.curriculum_subject_id
    JOIN public.curriculum_classes  cc ON cc.id = cs.curriculum_class_id
   WHERE cc.level = 12 ORDER BY ch.id LIMIT 1;
  IF ch5 IS NULL OR ch12 IS NULL THEN
    RAISE EXCEPTION 'probe29: need a Class 5 and a Class 12 chapter (got %, %)', ch5, ch12;
  END IF;

  -- ── 1. the session is real ──────────────────────────────────────────────
  r := pg_temp.as_user(t1, 'SELECT public.get_my_role()::text');
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('the probe session is genuinely authenticated (control)','teacher','OK: teacher', r,
     CASE WHEN r = 'OK: teacher' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 2. a Class 5 question, which the old range forbade ─────────────────
  r := pg_temp.as_user(t1, format(
        'WITH i AS (INSERT INTO public.question_bank '
        '(subject, chapter_id, class_level, question, options, correct_index, created_by) '
        'VALUES (''Mathematics'', %L::uuid, 5, ''probe29 class five'', ''["a","b","c","d"]''::jsonb, 0, %L::uuid) '
        'RETURNING class_level) SELECT class_level::text FROM i', ch5, t1));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('save a CLASS 5 question (§10.9 names it by hand)','teacher','OK: 5', r,
     CASE WHEN r = 'OK: 5' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 3. the class is derived when it is not given ───────────────────────
  r := pg_temp.as_user(t1, format(
        'WITH i AS (INSERT INTO public.question_bank '
        '(subject, chapter_id, question, options, correct_index, created_by) '
        'VALUES (''Mathematics'', %L::uuid, ''probe29 derived class'', ''["a","b","c","d"]''::jsonb, 0, %L::uuid) '
        'RETURNING class_level) SELECT class_level::text FROM i', ch12, t1));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('omit class_level: it is filled from the chapter','teacher','OK: 12', r,
     CASE WHEN r = 'OK: 12' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 4. a class that contradicts the chapter ────────────────────────────
  -- This is the §10.9 fence: a Class 12 chapter tagged Class 5 would be served
  -- to ten-year-olds by a filter that trusts the tag.
  r := pg_temp.as_user(t1, format(
        'WITH i AS (INSERT INTO public.question_bank '
        '(subject, chapter_id, class_level, question, options, correct_index, created_by) '
        'VALUES (''Mathematics'', %L::uuid, 5, ''probe29 mislabelled'', ''["a","b","c","d"]''::jsonb, 0, %L::uuid) '
        'RETURNING id) SELECT count(*)::text FROM i', ch12, t1));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('tag a Class 12 chapter as Class 5','teacher','ERROR disagrees with chapter', r,
     CASE WHEN r LIKE 'ERROR%disagrees with chapter%' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 5. the keying rule next door is untouched ──────────────────────────
  r := pg_temp.as_user(t1, format(
        'WITH i AS (INSERT INTO public.question_bank '
        '(subject, class_level, question, options, correct_index, created_by) '
        'VALUES (''Mathematics'', 10, ''probe29 unkeyed'', ''["a","b","c","d"]''::jsonb, 0, %L::uuid) '
        'RETURNING id) SELECT count(*)::text FROM i', t1));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('save a question with no chapter (positive control: §10.10 still holds)','teacher',
     'ERROR question_bank_active_must_be_keyed', r,
     CASE WHEN r LIKE 'ERROR%question_bank_active_must_be_keyed%' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 6. the rollout, as a reader ────────────────────────────────────────
  r := pg_temp.as_user(t1,
        'SELECT count(*)::text FROM public.question_bank WHERE class_level = 5 AND NOT is_active');
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('Class 5 questions left archived','teacher','OK: 0', r,
     CASE WHEN r = 'OK: 0' THEN 'PASS' ELSE 'FAIL' END);

  r := pg_temp.as_user(t1,
        'SELECT count(*)::text FROM public.question_bank WHERE class_level = 5 AND is_active');
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('Class 5 questions a teacher can now read','teacher','OK: >0', r,
     CASE WHEN r ~ '^OK: [1-9]' THEN 'PASS' ELSE 'FAIL' END);
END $probe$;

SELECT area, role_tested, expected, observed, verdict FROM probe ORDER BY n;
ROLLBACK;
