-- probe40: the generated question goes back to the bank UNAPPROVED, and only
-- the right people can put it there (§5, §10, §10.9, §10.20).
--
-- §5 says a generated question is written back "tagged, created_by set,
-- is_approved=false, topic NULL". Every one of those is a claim about a shared,
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
--   3. ...tagged ai_generated, credited, with topic NULL.         <- §5, rule 31
--   4. a STUDENT cannot see it, because it is unapproved.         <- the fence
--   5. ...while its author can.                             (POSITIVE CONTROL)
--   6. the PRINCIPAL cannot write to the bank.                    <- §10
--   7. ...but can still READ it.                            (POSITIVE CONTROL)
--   8. a STUDENT cannot write to the bank.                        <- the fence
--   9. the author cannot APPROVE their own question.              <- §10.20
--  10. a SHORT question cannot be stored at all.                  <- the schema
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
          created_by, is_approved, topic)
       VALUES (%L, %L, %s, 'medium', %L, '["a","b","c","d"]'::jsonb, 1,
               'because', 'mcq', 'ai_generated', %L, false, NULL)
       RETURNING id::text$q$, subj, chap, lvl, marker, teacher));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('a generated MCQ is written back to the bank (positive control)','teacher','OK: <uuid>', r,
     CASE WHEN r LIKE 'OK: ________-%' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 2/3. unapproved, tagged, credited, topic NULL ──────────────────────
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
     AND created_by = teacher
     AND topic IS NULL;
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('...tagged ai_generated, credited, topic NULL (rule 31)','-','OK: true', r,
     CASE WHEN r = 'OK: true' THEN 'PASS' ELSE 'FAIL' END);

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

  -- ── 10. a written-answer question has nowhere to go ────────────────────
  --
  -- Not a policy refusal: `options` and `correct_index` are NOT NULL, so the
  -- bank cannot hold a short or long question even though
  -- `question_bank_question_format_check` admits both. This is why the §5
  -- write-back is MCQ-only, and it is asserted so the day that changes, the
  -- claim changes with it.
  r := pg_temp.as_user(teacher, format(
    $q$INSERT INTO public.question_bank
         (subject, chapter_id, class_level, question, options, correct_index,
          explanation, question_format, source_type, created_by, is_approved)
       VALUES (%L, %L, %s, 'probe40 short question', NULL, NULL, 'because',
               'short', 'ai_generated', %L, false)
       RETURNING id::text$q$, subj, chap, lvl, teacher));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('storing a SHORT-answer question in the bank','teacher','ERROR: options not-null', r,
     CASE WHEN r LIKE 'ERROR:%not-null%' AND r LIKE '%options%' THEN 'PASS' ELSE 'FAIL' END);

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
