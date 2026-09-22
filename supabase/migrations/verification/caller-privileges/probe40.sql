-- probe40: the generated question goes back to the bank UNAPPROVED, and only
-- the right people can put it there (§5, §10, §10.9, §10.20).
--
-- §5 says a generated question is written back "tagged, created_by set,
-- is_approved=false" — and it said "topic NULL" until rule 31 was amended
-- (2026-09-15): topics are rows per chapter, question_bank.topic is DROPPED
-- (20261020010000), and a question names a topic of its OWN chapter or none.
-- This probe named the dropped column and stopped running (42703) — a check
-- that cannot run proves nothing. Every one of those is a claim about a shared,
-- cross-school table — `question_bank` has no `school_id` at all — so every one
-- of them is asserted here as the caller rather than trusted to the client.
--
-- Measuring the write path before building it found the principal in it:
-- `qb_staff_insert` read `is_principal_or_admin(...) OR has_role(teacher)`, and
-- §10 gives the principal announcements and nothing else. Closed by
-- 20260916080000; claims 6 and 7 hold it closed.
--
-- THE CLAIMS
--   1. a TEACHER writes a generated MCQ back.               (POSITIVE CONTROL)
--   2. ...and it lands UNAPPROVED.                                <- §5
--   3. ...tagged ai_generated and credited.                       <- §5
--  3a. a topic from ANOTHER chapter is refused.                   <- rule 31
--  3b. ...while a topic of its own chapter is taken.        (POSITIVE CONTROL)
--   4. a STUDENT cannot see it, because it is unapproved.         <- the fence
--   5. ...while its author can.                             (POSITIVE CONTROL)
--   6. the PRINCIPAL cannot write to the bank.                    <- §10
--   7. ...but can still READ it.                            (POSITIVE CONTROL)
--   8. a STUDENT cannot write to the bank.                        <- the fence
--   9. the author cannot APPROVE their own question.              <- §10.20
--  10. a written-answer question IS stored, answerless is not.   <- 20260916100000
--  11. anon holds no write grant.                                 <- the grant
--
-- 1, 5 and 7 are what make the refusals mean anything.
--
-- Everything is rolled back.
BEGIN;
SET LOCAL statement_timeout = '90s';
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
  teacher   uuid;
  principal uuid;
  student   uuid;
  chap      uuid;
  subj      text;
  lvl       int;
  marker    text := 'probe40 generated question';
  own_topic   uuid;
  other_topic uuid;
  r         text;
BEGIN
  SELECT id INTO teacher   FROM auth.users WHERE email='priya.sharma@wisdomcampus.com';
  SELECT id INTO principal FROM auth.users WHERE email='principal@wisdomcampus.com';
  SELECT s.user_id INTO student FROM public.students s
   WHERE s.user_id IS NOT NULL ORDER BY s.id LIMIT 1;

  -- A REAL curriculum chapter, taken from a row that already uses one.
  -- `question_bank_active_must_be_keyed` refuses an active row without a
  -- chapter_id, and `tg_question_bank_class_follows_chapter` refuses a class
  -- level that disagrees with it — so a made-up id would fail for the wrong
  -- reason and the claims below would prove nothing about the write-back.
  SELECT qb.chapter_id, qb.subject, qb.class_level INTO chap, subj, lvl
    FROM public.question_bank qb
   WHERE qb.chapter_id IS NOT NULL AND qb.class_level IS NOT NULL
   ORDER BY qb.id LIMIT 1;

  IF teacher IS NULL OR principal IS NULL OR student IS NULL OR chap IS NULL THEN
    RAISE EXCEPTION
      'probe40: fixtures missing (teacher=%, principal=%, student=%, chapter=%) '
      '— a skipped check is not a passing check', teacher, principal, student, chap;
  END IF;

  -- ── 1. the teacher writes one back ──────────────────────────────────────
  r := pg_temp.as_user(teacher, format(
    $q$INSERT INTO public.question_bank
         (subject, chapter_id, class_level, difficulty, question, options,
          correct_index, explanation, question_format, source_type,
          created_by, is_approved)
       VALUES (%L, %L, %s, 'medium', %L, '["a","b","c","d"]'::jsonb, 1,
               'because', 'mcq', 'ai_generated', %L, false)
       RETURNING id::text$q$, subj, chap, lvl, marker, teacher));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('a generated MCQ is written back to the bank (positive control)','teacher','OK: <uuid>', r,
     CASE WHEN r LIKE 'OK: ________-%' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 2/3. unapproved, tagged, credited ──────────────────────────────────
  SELECT CASE WHEN count(*) = 1 THEN 'OK: true' ELSE 'OK: false' END INTO r
    FROM public.question_bank
   WHERE question = marker AND is_approved = false;
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('...and it is UNAPPROVED (§5)','-','OK: true', r,
     CASE WHEN r = 'OK: true' THEN 'PASS' ELSE 'FAIL' END);

  SELECT CASE WHEN count(*) = 1 THEN 'OK: true' ELSE 'OK: false' END INTO r
    FROM public.question_bank
   WHERE question = marker
     AND source_type = 'ai_generated'
     AND created_by = teacher;
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('...tagged ai_generated and credited (§5)','-','OK: true', r,
     CASE WHEN r = 'OK: true' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 3a/3b. a topic of its own chapter, or none (rule 31, amended) ───────
  SELECT t.id INTO own_topic FROM public.topics t WHERE t.chapter_id = chap ORDER BY t.id LIMIT 1;
  SELECT t.id INTO other_topic FROM public.topics t WHERE t.chapter_id <> chap ORDER BY t.id LIMIT 1;
  IF own_topic IS NULL OR other_topic IS NULL THEN
    RAISE EXCEPTION 'probe40: no topic to test with (own=%, other=%) — a skipped check is not a passing check',
      own_topic, other_topic;
  END IF;

  r := pg_temp.as_user(teacher, format(
    $q$INSERT INTO public.question_bank
         (subject, chapter_id, class_level, difficulty, question, options,
          correct_index, explanation, question_format, source_type,
          created_by, is_approved, topic_id)
       VALUES (%L, %L, %s, 'medium', %L, '["a","b","c","d"]'::jsonb, 1,
               'because', 'mcq', 'ai_generated', %L, false, %L)
       RETURNING id::text$q$, subj, chap, lvl, marker || ' (foreign topic)', teacher, other_topic));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('a question naming another chapter''s topic is refused (rule 31)','teacher','ERROR', r,
     CASE WHEN r LIKE 'ERROR:%' THEN 'PASS' ELSE 'FAIL' END);

  r := pg_temp.as_user(teacher, format(
    $q$INSERT INTO public.question_bank
         (subject, chapter_id, class_level, difficulty, question, options,
          correct_index, explanation, question_format, source_type,
          created_by, is_approved, topic_id)
       VALUES (%L, %L, %s, 'medium', %L, '["a","b","c","d"]'::jsonb, 1,
               'because', 'mcq', 'ai_generated', %L, false, %L)
       RETURNING id::text$q$, subj, chap, lvl, marker || ' (own topic)', teacher, own_topic));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('...while one naming a topic of its own chapter is taken (positive control)','teacher','OK: <uuid>', r,
     CASE WHEN r LIKE 'OK: ________-%' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 4/5. who can see it ────────────────────────────────────────────────
  r := pg_temp.as_user(student, format(
        $q$SELECT count(*)::text FROM public.question_bank WHERE question = %L$q$, marker));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('an unapproved contribution reaches a student','student','OK: 0', r,
     CASE WHEN r = 'OK: 0' THEN 'PASS' ELSE 'FAIL' END);

  r := pg_temp.as_user(teacher, format(
        $q$SELECT count(*)::text FROM public.question_bank WHERE question = %L$q$, marker));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('...while its author can see it (positive control)','teacher','OK: 1', r,
     CASE WHEN r = 'OK: 1' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 6/7. the principal: no write, yes read ─────────────────────────────
  r := pg_temp.as_user(principal, format(
    $q$INSERT INTO public.question_bank
         (subject, chapter_id, class_level, question, options, correct_index,
          question_format, source_type, created_by, is_approved)
       VALUES (%L, %L, %s, 'probe40 principal question', '["a","b","c","d"]'::jsonb, 0,
               'mcq', 'ai_generated', %L, false)
       RETURNING id::text$q$, subj, chap, lvl, principal));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('writing to the cross-school question bank','principal (§10: announcements only)','ERROR: violates row-level security', r,
     CASE WHEN r LIKE 'ERROR:%row-level security%' THEN 'PASS' ELSE 'FAIL' END);

  r := pg_temp.as_user(principal, format(
        $q$SELECT count(*)::text FROM public.question_bank WHERE question = %L$q$, marker));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('...but reading it is unchanged (positive control)','principal','OK: 1', r,
     CASE WHEN r = 'OK: 1' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 8. a student ───────────────────────────────────────────────────────
  r := pg_temp.as_user(student, format(
    $q$INSERT INTO public.question_bank
         (subject, chapter_id, class_level, question, options, correct_index,
          question_format, created_by, is_approved)
       VALUES (%L, %L, %s, 'probe40 student question', '["a","b","c","d"]'::jsonb, 0,
               'mcq', %L, false)
       RETURNING id::text$q$, subj, chap, lvl, student));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('writing to the question bank','student','ERROR: violates row-level security', r,
     CASE WHEN r LIKE 'ERROR:%row-level security%' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 9. approving it is not the author's to do ──────────────────────────
  r := pg_temp.as_user(teacher, format(
    $q$WITH u AS (UPDATE public.question_bank SET is_approved = true
                   WHERE question = %L RETURNING 1)
       SELECT count(*)::text FROM u$q$, marker));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('approving their own contribution','teacher (§10.20)','ERROR: only a super admin', r,
     CASE WHEN r LIKE 'ERROR:%only a super admin%' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 10. a written-answer question now HAS somewhere to go ──────────────
  --
  -- `options` and `correct_index` were NOT NULL, so the bank could not hold a
  -- short or long question even though `question_bank_question_format_check`
  -- admitted both — the vocabulary anticipated them and the columns forbade
  -- them. `20260916100000` replaced the two NOT NULLs with one either/or
  -- CHECK, the same rule `qpq_answer_shape` already applied to the paper.
  r := pg_temp.as_user(teacher, format(
    $q$INSERT INTO public.question_bank
         (subject, chapter_id, class_level, question, options, correct_index,
          answer, explanation, question_format, source_type, created_by, is_approved)
       VALUES (%L, %L, %s, 'probe40 short question', NULL, NULL,
               'A complete written answer a teacher can mark against.',
               'because', 'short', 'ai_generated', %L, false)
       RETURNING id::text$q$, subj, chap, lvl, teacher));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('a SHORT-answer question is stored (positive control)','teacher','OK: <uuid>', r,
     CASE WHEN r LIKE 'OK: ________-%' THEN 'PASS' ELSE 'FAIL' END);

  -- ...and an ANSWERLESS one still is not. Dropping the NOT NULLs must not
  -- have opened the door to a question nobody can mark — that would be worse
  -- than the limitation it replaced.
  r := pg_temp.as_user(teacher, format(
    $q$INSERT INTO public.question_bank
         (subject, chapter_id, class_level, question, options, correct_index,
          answer, explanation, question_format, source_type, created_by, is_approved)
       VALUES (%L, %L, %s, 'probe40 answerless question', NULL, NULL, NULL,
               'because', 'short', 'ai_generated', %L, false)
       RETURNING id::text$q$, subj, chap, lvl, teacher));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('...while an ANSWERLESS question is still refused','teacher','ERROR: question_bank_answer_shape', r,
     CASE WHEN r LIKE 'ERROR:%question_bank_answer_shape%' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 11. anon ───────────────────────────────────────────────────────────
  SELECT 'OK: ' || count(*)::text INTO r
    FROM information_schema.role_table_grants
   WHERE table_schema='public' AND table_name='question_bank' AND grantee='anon'
     AND privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE');
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('write grants on the question bank','anon (the browser-bundle key)','OK: 0', r,
     CASE WHEN r = 'OK: 0' THEN 'PASS' ELSE 'FAIL' END);
END $probe$;

SELECT area, role_tested, expected, observed, verdict FROM probe ORDER BY n;
ROLLBACK;
