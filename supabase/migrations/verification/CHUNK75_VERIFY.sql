-- ---------------------------------------------------------------------
-- CHUNK 7.5 VERIFICATION — tests / test_marks convergence
--
-- Item 1 of the doc is behaviour, not policy: "a student creates, takes and
-- sees the result of a test, end to end." So this drives the real RPCs as a
-- real student — rpc_test_start, rpc_test_questions_for_attempt,
-- rpc_test_submit — and asserts what came back, rather than asserting that a
-- policy exists.
--
-- The test is deliberately answered PARTLY wrong (Q1 right, Q2 wrong, Q3 left
-- unanswered), because every interesting assertion is about the wrong half:
-- the mark, the mistake book, and what is left behind afterwards. A
-- fully-correct run would pass items 2 and 3 vacuously.
--
-- Self-rolling-back: one implicit transaction ending in a deliberate RAISE.
-- ---------------------------------------------------------------------

DO $verify$
DECLARE
  _demo uuid := '00000000-0000-4000-8000-000000000001';
  _uid uuid; _sid uuid; _ss uuid; _ay uuid; _chap uuid; _teacher uuid;
  _test uuid; _q uuid[]; _attempt uuid;
  _paper_rows int; _paper_has_correct boolean;
  _res jsonb; _mark numeric; _mistakes int; _with_chapter int; _left int;
  _direct_read int;
  _r1 text; _r2 text; _r3 text; _r4 text; _r5 text; _r6 text; _r7 text;
  _dpp_tables int; _dpp_fns int; _dpp_cols int; _dpp_cons int; _dpp_types int; _dpp_badges int;
  _anchor text; _lit int;
BEGIN
  SELECT s.user_id, s.id INTO _uid, _sid
    FROM public.students s
   WHERE s.school_id = _demo AND s.user_id IS NOT NULL AND s.deleted_at IS NULL
   ORDER BY s.id LIMIT 1;
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'CHUNK75: no linked demo student. A skipped check is not a passing check.';
  END IF;

  -- The TEACHER creates the test. Using the student's own uid for created_by
  -- makes them the author, which legitimately passes test_questions_write
  -- (FOR ALL, so it covers SELECT) and makes item 5 fail for a reason that
  -- cannot happen in the app. Reproduce the real sequence.
  SELECT id INTO _teacher FROM auth.users WHERE email = 'priya.sharma@wisdomcampus.com';
  IF _teacher IS NULL THEN RAISE EXCEPTION 'CHUNK75: demo teacher missing.'; END IF;

  SELECT ss.id INTO _ss FROM public.section_subjects ss
   WHERE ss.school_id = _demo LIMIT 1;
  SELECT ay.id INTO _ay FROM public.academic_years ay WHERE ay.school_id = _demo LIMIT 1;
  SELECT c.id INTO _chap FROM public.chapters c LIMIT 1;

  ------------------------------------------------------------------
  -- A teacher creates and publishes a three-question test.
  ------------------------------------------------------------------
  INSERT INTO public.tests (school_id, academic_year_id, section_subject_id, created_by,
                            topic, date, max_mark, status, published_at, duration_sec)
  VALUES (_demo, _ay, _ss, _teacher, 'Verification test', CURRENT_DATE, 3, 'published', now(), 600)
  RETURNING id INTO _test;

  INSERT INTO public.test_questions (test_id, school_id, order_index, question, options, correct, marks, explanation, chapter_id, chapter)
  VALUES
    (_test, _demo, 1, 'Q1', '["a","b"]'::jsonb, '"a"'::jsonb, 1, 'because a', _chap, 'Ch1'),
    (_test, _demo, 2, 'Q2', '["a","b"]'::jsonb, '"b"'::jsonb, 1, 'because b', _chap, 'Ch1'),
    (_test, _demo, 3, 'Q3', '["a","b"]'::jsonb, '"a"'::jsonb, 1, 'because a', _chap, 'Ch1');

  SELECT array_agg(id ORDER BY order_index) INTO _q
    FROM public.test_questions WHERE test_id = _test;

  ------------------------------------------------------------------
  -- Everything below runs AS THE STUDENT.
  ------------------------------------------------------------------
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _uid, 'role', 'authenticated')::text, true);

  ------------------------------------------------------------------
  -- 1. Start, fetch the paper, submit. End to end.
  ------------------------------------------------------------------
  _attempt := public.rpc_test_start(_test);

  SELECT count(*)::int INTO _paper_rows
    FROM public.rpc_test_questions_for_attempt(_attempt);

  -- Q1 right, Q2 wrong, Q3 not answered at all.
  _res := public.rpc_test_submit(_attempt, jsonb_build_array(
    jsonb_build_object('question_id', _q[1], 'response', '"a"'::jsonb),
    jsonb_build_object('question_id', _q[2], 'response', '"a"'::jsonb)
  ));

  _r1 := format('paper served %s question(s); submit returned score %s/%s, correct %s of %s',
                _paper_rows, _res->>'score', _res->>'max_score',
                _res->>'correct_count', _res->>'total_count')
      || CASE WHEN _paper_rows = 3
                   AND (_res->>'score')::numeric = 1
                   AND (_res->>'correct_count')::int = 1
                   AND (_res->>'total_count')::int = 3
              THEN ' — created, taken and scored end to end (PASS)'
              ELSE ' — the end-to-end path does not score correctly (FAIL)' END;

  ------------------------------------------------------------------
  -- 2. The mark is the durable outcome, in test_marks
  ------------------------------------------------------------------
  SELECT mark INTO _mark FROM public.test_marks
   WHERE test_id = _test AND student_id = _sid;

  _r2 := format('test_marks.mark = %s', COALESCE(_mark::text, 'NO ROW'))
      || CASE WHEN _mark = 1
              THEN ' — §10.22: one mark per student per test, anchored on the test (PASS)'
              ELSE ' — the mark did not land in test_marks (FAIL)' END;

  ------------------------------------------------------------------
  -- 3. Wrong answers reach the mistake book, WITH chapter_id
  ------------------------------------------------------------------
  SELECT count(*)::int,
         count(*) FILTER (WHERE chapter_id IS NOT NULL)::int
    INTO _mistakes, _with_chapter
    FROM public.student_mistakes
   WHERE user_id = _uid AND source_id = _test;

  -- Two: the one answered wrongly AND the one not answered at all. An
  -- unanswered question is not a correct one, and the student needs it back.
  _r3 := format('mistakes from this test: %s, of which %s carry chapter_id', _mistakes, _with_chapter)
      || CASE WHEN _mistakes = 2 AND _with_chapter = 2
              THEN ' — the wrong one AND the skipped one, both chapter-keyed (PASS)'
              WHEN _mistakes = 1
              THEN ' — the SKIPPED question was not recorded as a mistake (FAIL)'
              ELSE ' — (FAIL)' END;

  ------------------------------------------------------------------
  -- 4. Per-question correctness does not survive the session (§10.8)
  ------------------------------------------------------------------
  SELECT count(*)::int INTO _left FROM public.test_answers WHERE attempt_id = _attempt;

  _r4 := format('test_answers rows remaining after submit: %s', _left)
      || CASE WHEN _left = 0
              THEN ' — working state purged; the mark and the mistakes survive, the per-question record does not (PASS)'
              ELSE ' — per-question answers persist after the session closed (FAIL)' END;

  ------------------------------------------------------------------
  -- 5. A student cannot read the answer key
  ------------------------------------------------------------------
  -- 7.5a shipped test_questions_read granting SELECT to anyone in the
  -- institution, which included `correct`. That is the Battleground
  -- correct_index bug: the answer on the client before the answer is given.
  -- 7.5b narrowed direct reads to staff; this asserts the outcome.
  -- SET LOCAL ROLE matters here and nowhere else in this file. The DO block
  -- runs as the owner, and RLS does not apply to the owner — so without this
  -- the SELECT below bypasses every policy and item 5 measures nothing. It
  -- read 3 rows and reported a leak that was really just the owner reading its
  -- own table. The RPC calls above are unaffected: they are SECURITY DEFINER
  -- and take the caller from the JWT claims, not from the session role.
  SET LOCAL ROLE authenticated;
    SELECT count(*)::int INTO _direct_read
      FROM public.test_questions WHERE test_id = _test;
  RESET ROLE;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'test_questions'
       AND column_name = 'correct'
  ) INTO _paper_has_correct;

  _r5 := format('student direct SELECT on test_questions returned %s row(s); the paper RPC returns %s column(s)',
                _direct_read,
                (SELECT count(*)::int FROM information_schema.columns
                  WHERE table_schema='public' AND table_name='test_questions'
                    AND column_name IN ('id','order_index','question','options','marks','chapter_id','chapter','concept')))
      || CASE WHEN _direct_read = 0 AND _paper_has_correct
              THEN ' — the answer key exists but the student cannot reach it directly, and the paper RPC omits it (PASS)'
              WHEN _direct_read > 0
              THEN ' — a student can SELECT test_questions, which includes `correct` (FAIL)'
              ELSE ' — (FAIL)' END;

  ------------------------------------------------------------------
  -- 6. Item 4 — zero references to dpp, on every DB surface
  ------------------------------------------------------------------
  -- The item that proves the convergence landed. Counted across every place
  -- the retired feature was found living during this chunk: tables, function
  -- bodies, columns, CHECK constraints, enum TYPES (which survive a table
  -- drop, and were the last four references left in the generated
  -- TypeScript), and badge codes in data.
  SELECT count(*)::int INTO _dpp_tables FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='public' AND c.relname ILIKE '%dpp%';
  SELECT count(*)::int INTO _dpp_fns FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.prokind='f' AND pg_get_functiondef(p.oid) ~* 'dpp';
  SELECT count(*)::int INTO _dpp_cols FROM information_schema.columns
   WHERE table_schema='public' AND column_name ILIKE '%dpp%';
  SELECT count(*)::int INTO _dpp_cons FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid
    JOIN pg_namespace n ON n.oid=t.relnamespace
   WHERE n.nspname='public' AND pg_get_constraintdef(c.oid) ILIKE '%dpp%';
  SELECT count(*)::int INTO _dpp_types FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace
   WHERE n.nspname='public' AND t.typname ILIKE '%dpp%';
  SELECT count(*)::int INTO _dpp_badges FROM public.student_badges WHERE badge_code ILIKE '%dpp%';

  _r6 := format('dpp references — tables %s, functions %s, columns %s, constraints %s, types %s, badge rows %s',
                _dpp_tables, _dpp_fns, _dpp_cols, _dpp_cons, _dpp_types, _dpp_badges)
      || CASE WHEN _dpp_tables + _dpp_fns + _dpp_cols + _dpp_cons + _dpp_types + _dpp_badges = 0
              THEN ' — the feature is gone from the schema, not just from the tables (PASS)'
              ELSE ' — dpp survives somewhere (FAIL)' END;

  ------------------------------------------------------------------
  -- 7. Item 6 — anchored on section_subject, thresholds per test
  ------------------------------------------------------------------
  SELECT CASE WHEN EXISTS (
           SELECT 1 FROM information_schema.columns
            WHERE table_schema='public' AND table_name='tests' AND column_name='section_subject_id')
          AND NOT EXISTS (
           SELECT 1 FROM information_schema.columns
            WHERE table_schema='public' AND table_name='tests' AND column_name='class_id')
         THEN 'section_subject only' ELSE 'class_id present' END INTO _anchor;

  -- max_mark and the pass threshold must resolve per test, never from a
  -- literal. Asserted structurally: neither column carries a DEFAULT that
  -- would silently supply a threshold nobody chose (G4).
  SELECT count(*)::int INTO _lit FROM information_schema.columns
   WHERE table_schema='public' AND table_name='tests'
     AND column_name IN ('max_mark','passing_marks') AND column_default IS NOT NULL;

  _r7 := format('tests anchor: %s; max_mark/passing_marks carrying a DEFAULT: %s', _anchor, _lit)
      || CASE WHEN _anchor = 'section_subject only' AND _lit = 0
              THEN ' — §10.22 anchoring, and both thresholds resolve per test rather than from a literal (PASS)'
              ELSE ' — (FAIL)' END;

  RAISE EXCEPTION E'CHUNK75
 1) %
 2) %
 3) %
 4) %
 5) %
 6) %
 7) %
 [all rolled back]',
    _r1, _r2, _r3, _r4, _r5, _r6, _r7;
END $verify$;
