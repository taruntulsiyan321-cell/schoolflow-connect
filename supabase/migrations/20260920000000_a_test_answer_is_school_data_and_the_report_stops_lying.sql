-- ═══════════════════════════════════════════════════════════════════════════
-- A test answer is school data (§10.23, §10.25, rules 12-15)
--
-- ── WHAT WAS MEASURED, END TO END, BEFORE THIS WAS WRITTEN ────────────────
--
-- A teacher created a test, published it, three students sat it and submitted.
-- Driven as the real callers (teacher, then each student, each under RLS with
-- their own claims), the grading was right and every report built on top of it
-- was wrong:
--
--   student A answered 2 of 3 correctly
--     attempt.score .................... 2      correct
--     test_marks.mark .................. 2      correct
--     test_answers rows left ........... 0      <- the defect
--     report.wrong_answers ............. 3      every question, not the one
--     report.wrong_answers[].their_answer  null every one of them
--     report.wrong_answers[].answered .. false  on questions they answered
--     class report weakest_topics ...... "HCF and LCM 6 of 6 wrong, 100%",
--                                        "Irrational numbers 3 of 3, 100%"
--                                        for a class that averaged 2 of 3
--     class report avg seconds/question  null
--
-- The cause is the last statement of `rpc_test_submit`:
--
--     DELETE FROM public.test_answers WHERE attempt_id = _attempt_id;
--
-- It grades from `test_answers`, writes the durable mark, and then deletes the
-- rows every report reads. `rpc_test_student_report` and `rpc_test_class_report`
-- both LEFT JOIN that table and treat `COALESCE(ans.is_correct,false) = false`
-- as "wrong", so once the rows are gone EVERY question of the paper is reported
-- wrong, with the correct answer attached and the student's own response shown
-- as blank. Three surfaces were affected: the student's own result screen, the
-- teacher's per-student drill-down, and the teacher's weakest-topics ranking —
-- the primary view.
--
-- ── WHY DELETING THEM WAS ONCE RIGHT, AND IS NOT NOW ─────────────────────
--
-- Chunk 7.5a introduced the purge under §10.8's transient rule, calling the
-- per-question rows "working state needed to grade". Three things have changed
-- since, all of them recorded:
--
--   §10.23      test answers are SCHOOL data — "a teacher set them and a mark
--               is the point" — not practice, so the transient rule does not
--               reach them.
--   §10.25      the report must offer "their actual wrong answers, with the
--               topic on each" on tap, which requires the rows kept.
--   rule 14     the 24-hour expiry of the test report was WITHDRAWN on
--               2026-09-11 after being measured: nothing expires a test answer
--               today, and the spec requires that nothing does.
--
-- So the rows are durable from here. Nothing else in the schema expires them:
-- there is no `expires_at` on any test table and no purge function — this
-- statement was the only deletion of a test answer in the system.
--
-- ── EVERY CONNECTION POINT, RE-CHECKED ────────────────────────────────────
--
--   rpc_test_student_report   reads test_answers  -> now finds them (fixed)
--   rpc_test_class_report     reads test_answers  -> topics + timing (fixed)
--   TestResult.tsx            TestService.listAnswers -> the question review
--                             stops saying "not recorded" (rule 27)
--   test_answers RLS          `test_answers_self` is the student's own rows;
--                             staff reach them only through the two SECURITY
--                             DEFINER reports, which is unchanged.
--   student_mistakes          still written here, unchanged — it is the
--                             cross-test mistake book, not this test's review.
--   test_marks                still written here, unchanged and still first:
--                             the mark is durable before any report exists.
--
-- ── THREE MORE DEFECTS FIXED IN THE SAME FUNCTION ────────────────────────
--
-- 1. `test_attempts.time_spent_sec` was never written by anything. The result
--    screen renders `Math.round(time_spent_sec/60)` and therefore always said
--    "0m", and the activity bump below read the same column to decide how many
--    minutes of study to record. It is now computed from the attempt's own
--    clock, capped at the paper's duration for a timed test — a paper left open
--    for two days is not two days of work.
--
-- 2. The activity bump could never run:
--
--      _bump_academic_activity(uuid,int,int,int,int)         20260606000000
--      _bump_academic_activity(uuid,int,int,int,int,int)     20260614000000
--
--    Five positional arguments match both, so the call raised 42725 "function
--    is not unique", was caught by this function's own EXCEPTION handler, and
--    became a WARNING nobody reads. Measured: submitting a test left
--    `academic_daily_activity` with no row at all. The call now names the
--    six-argument form explicitly. (The duplicate itself is removed by
--    20260920010000 — this only stops depending on which one wins.)
--
-- 3. `test_marks.uploaded_at` was left NULL, and `_parent_weekly_digest`
--    windows on `COALESCE(tm.uploaded_at, tm.created_at)` and orders by
--    `uploaded_at DESC NULLS LAST`. A re-marked attempt kept its original
--    created_at, so it could fall outside the week it was actually taken in.
--    Submitting now stamps it.
--
-- Rollback: supabase/migrations/rollback/
--           20260920000000_a_test_answer_is_school_data_and_the_report_stops_lying.rollback.sql
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.rpc_test_submit(_attempt_id uuid, _answers jsonb DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _att record;
  _score numeric := 0; _correct int := 0; _total int := 0;
  _elapsed int;
  _limit int;
  _result jsonb;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;

  SELECT * INTO _att FROM public.test_attempts WHERE id = _attempt_id;
  IF _att IS NULL THEN RAISE EXCEPTION 'no such attempt'; END IF;
  IF _att.user_id <> _uid THEN RAISE EXCEPTION 'Not your attempt'; END IF;
  IF _att.status = 'submitted' THEN RAISE EXCEPTION 'already submitted'; END IF;

  -- Land whatever the client is holding. The per-question saves have normally
  -- already written these rows; a submit that carries them as well is how an
  -- answer whose own save failed still reaches the marking.
  --
  -- `time_ms` travels with the answer. It is the only source for §10.25's
  -- "average time per question" — the column existed and nothing ever filled
  -- it, so that figure was structurally NULL on every report ever rendered.
  INSERT INTO public.test_answers (attempt_id, question_id, school_id, response, time_ms)
  SELECT _attempt_id, (e->>'question_id')::uuid, _att.school_id, e->'response',
         NULLIF(e->>'time_ms', '')::int
    FROM jsonb_array_elements(COALESCE(_answers, '[]'::jsonb)) e
   WHERE (e->>'question_id') IS NOT NULL
  ON CONFLICT (attempt_id, question_id) DO UPDATE
     SET response = EXCLUDED.response,
         -- A submit that carries no timing must not erase the timing the
         -- per-question saves recorded.
         time_ms  = COALESCE(EXCLUDED.time_ms, test_answers.time_ms);

  -- An answer is right when it equals the key. Every online question is an MCQ
  -- (20260920020000), the key is a position, and the renderer can only send a
  -- position it drew — so this equality is the whole of the marking, and no
  -- human decides any part of it.
  UPDATE public.test_answers a
     SET is_correct    = (a.response IS NOT NULL AND a.response = q.correct),
         marks_awarded = CASE WHEN a.response IS NOT NULL AND a.response = q.correct
                              THEN q.marks ELSE 0 END
    FROM public.test_questions q
   WHERE q.id = a.question_id AND a.attempt_id = _attempt_id;

  SELECT COALESCE(sum(a.marks_awarded), 0),
         count(*) FILTER (WHERE a.is_correct)::int,
         (SELECT count(*)::int FROM public.test_questions q WHERE q.test_id = _att.test_id)
    INTO _score, _correct, _total
    FROM public.test_answers a WHERE a.attempt_id = _attempt_id;

  -- The wrong ones become the mistake book, WITH chapter_id (7.5 item 2).
  -- Skipped questions count as wrong: an unanswered question is not a
  -- correct one, and the student needs it back.
  INSERT INTO public.student_mistakes (
    user_id, student_id, school_id, question_id, source, source_id,
    subject, chapter, chapter_id, concept, question_text, options,
    student_answer, correct_answer, explanation,
    times_wrong, last_wrong_at, status, assessment_type
  )
  SELECT _uid, _att.student_id, _att.school_id, q.id, 'test', _att.test_id,
         COALESCE(cs.name, 'General'), q.chapter, q.chapter_id, q.concept,
         q.question, q.options, a.response, q.correct, q.explanation,
         1, now(), 'open', 'test'
    FROM public.test_questions q
    LEFT JOIN public.test_answers a ON a.question_id = q.id AND a.attempt_id = _attempt_id
    LEFT JOIN public.tests t ON t.id = q.test_id
    LEFT JOIN public.section_subjects ss ON ss.id = t.section_subject_id
    LEFT JOIN public.curriculum_subjects cs ON cs.id = ss.curriculum_subject_id
   WHERE q.test_id = _att.test_id
     AND COALESCE(a.is_correct, false) = false
     -- NOT EXISTS, not ON CONFLICT: student_mistakes carries only a PRIMARY KEY
     -- on a generated uuid, so ON CONFLICT DO NOTHING can never fire and a
     -- retake would insert the same mistake twice.
     AND NOT EXISTS (
       SELECT 1 FROM public.student_mistakes sm
        WHERE sm.user_id = _uid AND sm.question_id = q.id
     );

  -- A question got wrong AGAIN is not a new mistake, it is the same one
  -- recurring: bump the counter and re-open it if it had been cleared.
  UPDATE public.student_mistakes sm
     SET times_wrong  = sm.times_wrong + 1,
         last_wrong_at = now(),
         status       = 'open',
         cleared_at   = NULL
    FROM public.test_questions q
    LEFT JOIN public.test_answers a2 ON a2.question_id = q.id AND a2.attempt_id = _attempt_id
   WHERE q.test_id = _att.test_id
     AND sm.question_id = q.id
     AND sm.user_id = _uid
     AND sm.last_wrong_at < now()
     AND COALESCE(a2.is_correct, false) = false;

  -- How long the paper actually took. Capped at the paper's own limit when it
  -- has one: the timer auto-submits at zero, so anything beyond that is a
  -- clock that kept running, not work that was done.
  SELECT t.duration_sec INTO _limit FROM public.tests t WHERE t.id = _att.test_id;
  _elapsed := GREATEST(1, CEIL(EXTRACT(EPOCH FROM (now() - _att.started_at)))::int);
  IF _limit IS NOT NULL AND _limit > 0 THEN
    _elapsed := LEAST(_elapsed, _limit);
  END IF;

  UPDATE public.test_attempts
     SET status = 'submitted', submitted_at = now(),
         score = _score, correct_count = _correct, total_count = _total,
         time_spent_sec = _elapsed
   WHERE id = _attempt_id;

  -- The durable outcome, and it is written here rather than anywhere later:
  -- test_marks is the authority (§10.22), one mark per student per test, and
  -- the marks reach the student's profile before any report of any kind exists.
  INSERT INTO public.test_marks (school_id, test_id, student_id, mark, uploaded_at)
  SELECT _att.school_id, _att.test_id, _att.student_id, _score, now()
   WHERE _att.student_id IS NOT NULL
  ON CONFLICT (test_id, student_id) DO UPDATE
     SET mark = EXCLUDED.mark, uploaded_at = EXCLUDED.uploaded_at;

  _result := jsonb_build_object(
    'attempt_id', _attempt_id,
    'score', _score,
    'max_score', _att.max_score,
    'correct_count', _correct,
    'total_count', _total,
    'time_spent_sec', _elapsed,
    'questions', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', q.id, 'order_index', q.order_index, 'question', q.question,
               'options', q.options, 'correct', q.correct,
               'explanation', q.explanation,
               'response', a.response,
               'is_correct', COALESCE(a.is_correct, false)
             ) ORDER BY q.order_index)
        FROM public.test_questions q
        LEFT JOIN public.test_answers a ON a.question_id = q.id AND a.attempt_id = _attempt_id
       WHERE q.test_id = _att.test_id), '[]'::jsonb)
  );

  -- THE PER-QUESTION ROWS STAY. See the header: they are school data, three
  -- surfaces read them, and this function deleting them is the defect this
  -- migration exists to remove.

  BEGIN
    -- Six arguments, named form. Five positional arguments matched two
    -- overloads and raised 42725 every single time. The second parameter is
    -- `_test`, not `_dpp` — it was renamed with the rest of the dpp vocabulary
    -- in 7.5c, and a test submit is exactly what it counts.
    PERFORM public._bump_academic_activity(
      _uid := _uid, _test := 1, _hw := 0, _battle := 0,
      _mins := GREATEST(_elapsed / 60, 1), _self_practice := 0);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'rpc_test_submit(%): activity bump failed: %', _attempt_id, SQLERRM;
  END;

  RETURN _result;
END;
$function$;

REVOKE ALL ON FUNCTION public.rpc_test_submit(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_test_submit(uuid, jsonb) TO authenticated;

COMMENT ON FUNCTION public.rpc_test_submit(uuid, jsonb) IS
  'Grades a submitted attempt by comparing each answer to its key, writes the '
  'durable mark to test_marks, sends the wrong ones to the mistake book, and '
  'KEEPS the per-question rows: they are school data (§10.23) and the reports '
  'read them (§10.25). See 20260920000000 for what deleting them broke.';

-- ── Proof, as the student, before this is called done ─────────────────────
--
-- This builds its own test, sits it as the student who owns the attempt, and
-- asserts on the rows afterwards — then removes every row it created. A
-- DO block runs as `postgres`, which proves nothing about permissions, so it
-- proves BEHAVIOUR only: what the grading wrote, and what survived it. The
-- permission half is probe44.
DO $verify$
DECLARE
  _school uuid; _ss uuid; _teacher uuid; _stu_user uuid; _stu uuid;
  _test uuid; _q1 uuid; _q2 uuid; _attempt uuid;
  _answers_left int; _score numeric; _spent int; _wrong int; _answered int;
  _activity_before int; _activity_had_row boolean; _activity_after int;
BEGIN
  -- A section that has a subject, a teacher who teaches it under an ACTIVE
  -- TEACHER MEMBERSHIP, and a student on its roll with a sign-in account. The
  -- membership is not decoration: `teacher_teaches_class` resolves the caller
  -- through `active_local_person_id()`, so a teacher without one "teaches
  -- nothing" and claim 5 below would fail for a reason that is not this
  -- migration's. Picked rather than named, so this runs on any tenant.
  SELECT ss.school_id, ss.id, t.user_id, s.user_id, s.id
    INTO _school, _ss, _teacher, _stu_user, _stu
    FROM public.section_subjects ss
    JOIN public.students s ON s.class_id = ss.section_id AND s.school_id = ss.school_id
                          AND s.user_id IS NOT NULL AND s.deleted_at IS NULL
    JOIN public.teacher_classes tc ON tc.class_id = ss.section_id
    JOIN public.teachers t ON t.id = tc.teacher_id AND t.user_id IS NOT NULL
                          AND t.deleted_at IS NULL
    JOIN public.memberships m ON m.local_person_id = t.id AND m.role = 'teacher'
                             AND m.status = 'active' AND m.school_id = ss.school_id
   LIMIT 1;

  IF _stu IS NULL THEN
    RAISE EXCEPTION
      'ROLLED BACK: no section with a subject, a teacher holding an active membership and a signed-up student — a check that cannot run is not a check that passed';
  END IF;

  INSERT INTO public.tests (school_id, section_subject_id, created_by, title,
                            max_mark, total_marks, status, test_kind, duration_sec, published_at)
  VALUES (_school, _ss, _teacher, '[verify 20260920000000] durable answers',
          2, 2, 'published', 'class_test', 1800, now())
  RETURNING id INTO _test;

  INSERT INTO public.test_questions (test_id, school_id, order_index, question_format,
                                     question, options, correct, marks, explanation, concept)
  VALUES (_test, _school, 0, 'mcq', 'verify: 2 + 2 ?', '["3","4"]', '{"indexes":[1]}', 1, 'four', 'Addition')
  RETURNING id INTO _q1;
  INSERT INTO public.test_questions (test_id, school_id, order_index, question_format,
                                     question, options, correct, marks, explanation, concept)
  VALUES (_test, _school, 1, 'mcq', 'verify: 3 + 3 ?', '["6","7"]', '{"indexes":[0]}', 1, 'six', 'Addition')
  RETURNING id INTO _q2;

  SELECT practice_minutes, true INTO _activity_before, _activity_had_row
    FROM public.academic_daily_activity
   WHERE user_id = _stu_user AND activity_date = CURRENT_DATE;
  _activity_before := COALESCE(_activity_before, 0);
  _activity_had_row := COALESCE(_activity_had_row, false);

  -- As the student, from here.
  PERFORM set_config('request.jwt.claims',
                     json_build_object('sub', _stu_user, 'role', 'authenticated')::text, true);

  _attempt := public.rpc_test_start(_test);
  -- Answer the first right and the second wrong, and carry the timing the way
  -- the attempt screen now does.
  PERFORM public.rpc_test_submit(_attempt, jsonb_build_array(
    jsonb_build_object('question_id', _q1, 'response', '{"indexes":[1]}'::jsonb, 'time_ms', 4000),
    jsonb_build_object('question_id', _q2, 'response', '{"indexes":[1]}'::jsonb, 'time_ms', 6000)
  ));

  SELECT count(*) INTO _answers_left FROM public.test_answers WHERE attempt_id = _attempt;
  SELECT score, time_spent_sec INTO _score, _spent FROM public.test_attempts WHERE id = _attempt;

  -- 1. The rows survive. This is the whole migration.
  IF _answers_left <> 2 THEN
    RAISE EXCEPTION 'ROLLED BACK: % answer row(s) survived the submit, expected 2 — the purge is still there', _answers_left;
  END IF;

  -- 2. The marking is still right. Without this, deleting the grading UPDATE
  --    would satisfy claim 1.
  IF _score <> 1 THEN
    RAISE EXCEPTION 'ROLLED BACK: score is %, expected 1 of 2', _score;
  END IF;

  -- 3. The report now says one wrong answer, not the whole paper, and knows
  --    which question was actually answered. Still as the student: the report
  --    fences itself on auth.uid(), so reading it with the claims cleared
  --    would be refused for a reason that has nothing to do with this change.
  SELECT jsonb_array_length(r -> 'wrong_answers'),
         (SELECT count(*) FROM jsonb_array_elements(r -> 'wrong_answers') w
           WHERE (w ->> 'answered')::boolean)
    INTO _wrong, _answered
    FROM public.rpc_test_student_report(_test, _stu) r;

  IF _wrong <> 1 THEN
    RAISE EXCEPTION 'ROLLED BACK: the report lists % wrong answer(s) for a 1-of-2 paper, expected 1', _wrong;
  END IF;
  IF _answered <> 1 THEN
    RAISE EXCEPTION 'ROLLED BACK: the wrong answer is reported as unanswered — their_answer did not survive';
  END IF;

  -- 4. The attempt records how long it took.
  IF _spent IS NULL OR _spent < 1 THEN
    RAISE EXCEPTION 'ROLLED BACK: time_spent_sec is % — the result screen would say 0m again', _spent;
  END IF;

  -- 5. The activity bump ran. This is the claim that fails if the ambiguous
  --    five-argument call comes back.
  SELECT COALESCE(sum(practice_minutes), 0)::int INTO _activity_after
    FROM public.academic_daily_activity
   WHERE user_id = _stu_user AND activity_date = CURRENT_DATE;
  IF _activity_after <= _activity_before THEN
    RAISE EXCEPTION 'ROLLED BACK: daily activity did not move (% -> %) — the bump is still being swallowed',
      _activity_before, _activity_after;
  END IF;

  -- 6. The class report's timing figure has data to compute from. Read as the
  --    TEACHER, because that is who may read a class report.
  PERFORM set_config('request.jwt.claims',
                     json_build_object('sub', _teacher, 'role', 'authenticated')::text, true);
  IF (SELECT (public.rpc_test_class_report(_test) ->> 'average_seconds_per_question')) IS NULL THEN
    RAISE EXCEPTION 'ROLLED BACK: average_seconds_per_question is still NULL with time_ms recorded';
  END IF;
  PERFORM set_config('request.jwt.claims', '', true);

  -- Clean up in dependency order: two constraints RESTRICT the test row, and
  -- the activity row is put back exactly as it was found rather than left
  -- carrying a minute of study nobody did.
  DELETE FROM public.student_mistakes WHERE source_id = _test;
  IF _activity_had_row THEN
    UPDATE public.academic_daily_activity SET practice_minutes = _activity_before
     WHERE user_id = _stu_user AND activity_date = CURRENT_DATE;
  ELSE
    DELETE FROM public.academic_daily_activity
     WHERE user_id = _stu_user AND activity_date = CURRENT_DATE;
  END IF;
  DELETE FROM public.test_marks WHERE test_id = _test;
  DELETE FROM public.test_answers WHERE attempt_id = _attempt;
  DELETE FROM public.test_attempts WHERE test_id = _test;
  DELETE FROM public.test_questions WHERE test_id = _test;
  DELETE FROM public.tests WHERE id = _test;

  RAISE NOTICE 'verify OK: answers survive the submit (2), score 1 of 2, report lists 1 wrong with the answer on it, time recorded (%s), activity bumped', _spent;
END
$verify$;
