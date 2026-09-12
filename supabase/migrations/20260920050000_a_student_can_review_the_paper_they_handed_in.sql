-- ═══════════════════════════════════════════════════════════════════════════
-- A student can review the paper they handed in (§10.25, rule 27)
--
-- ── WHAT THE RESULT SCREEN COULD NOT DO, AND WHY ─────────────────────────
--
-- `TestResult.tsx` renders a "Question review": every question, what the student
-- answered, whether it was right, and the correct answer. It assembled that from
-- two client reads:
--
--     TestService.listQuestions(ctx, id)   -> the paper
--     TestService.listAnswers(ctx, attempt)-> their responses
--
-- and neither could carry what the screen needs:
--
--   1. For a student, `listQuestions` goes through
--      `rpc_test_questions_for_attempt`, whose RETURNS list deliberately omits
--      `correct` and `explanation` — it is the paper, not the answer key, and
--      that is exactly right BEFORE the paper is handed in. After it is handed
--      in, the screen has no way to say what the right answer was.
--   2. `listAnswers` reads `test_answers` directly, which was purged at submit
--      until 20260920000000. Rule 27's honest empty state — "Your individual
--      answers for this test were not recorded" — was therefore what EVERY
--      student saw after EVERY test.
--
-- (1) survives the durability fix: the answers are there now, but the key still
-- is not, so a review would show "you answered B" with nothing to compare it to.
--
-- ── THE SHAPE OF THE FIX ─────────────────────────────────────────────────
--
-- One fenced function that answers one question: "what did this student answer,
-- and what was right?" — available only for an attempt that has been SUBMITTED.
-- Before submission it returns `submitted: false` and NO questions at all, which
-- is the same fail-closed shape `rpc_test_student_report` adopted in
-- 20260916020000 after it was found handing out the paper with its key to a
-- student who had not sat it.
--
-- It is NOT a widening of `rpc_test_student_report`. That function answers a
-- different question — "which TOPICS did the wrong answers fall in" (§10.25
-- returns only the wrong ones, deliberately: "a per-question list of what they
-- got RIGHT is not part of the report"). A review of your own submitted paper is
-- a different surface with a different audience, so it gets its own function
-- rather than a flag on that one.
--
-- Audience: whoever may already see this student's per-question detail —
-- `can_read_test_student_report`, which is the teachers of that section, the
-- student themselves, and a parent of that child once it is sat. One fence, no
-- second copy of the rule (G9).
--
-- Rollback: supabase/migrations/rollback/
--           20260920050000_a_student_can_review_the_paper_they_handed_in.rollback.sql
-- Assertion: supabase/migrations/verification/caller-privileges/probe44.sql
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.rpc_test_answer_sheet(_test_id uuid, _student_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _out jsonb;
BEGIN
  IF NOT public.can_read_test_student_report(_test_id, _student_id) THEN
    RAISE EXCEPTION 'Not your test paper' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'test_id', _test_id,
    'student_id', _student_id,
    'title', t.title,
    'max_mark', t.max_mark,
    'mark', a.score,
    'correct_count', a.correct_count,
    'total_count', a.total_count,
    'submitted_at', a.submitted_at,
    'time_spent_sec', a.time_spent_sec,
    'submitted', (a.id IS NOT NULL),
    -- THE KEY TRAVELS ONLY WITH A SUBMITTED ATTEMPT. An empty array for a
    -- student who has not handed in is the whole fence: the CASE is evaluated
    -- before the subquery, so nothing about the paper is computed at all.
    'questions', CASE WHEN a.id IS NULL THEN '[]'::jsonb ELSE COALESCE((
       SELECT jsonb_agg(jsonb_build_object(
                'question_id', q.id,
                'order_index', q.order_index,
                'question', q.question,
                'options', q.options,
                'question_format', q.question_format,
                'marks', q.marks,
                'topic', COALESCE(NULLIF(btrim(q.concept), ''), NULLIF(btrim(q.chapter), ''), 'Unlabelled'),
                'their_answer', ans.response,
                'correct_answer', q.correct,
                'explanation', q.explanation,
                'marks_awarded', COALESCE(ans.marks_awarded, 0),
                -- Three states, not two: right, wrong, and never answered.
                -- A screen that renders "blank" and "wrong" the same way makes
                -- a claim about what the student did (G4).
                'answered', (ans.id IS NOT NULL),
                'is_correct', COALESCE(ans.is_correct, false),
                'time_ms', ans.time_ms
              ) ORDER BY q.order_index)
         FROM public.test_questions q
         LEFT JOIN public.test_answers ans
                ON ans.question_id = q.id AND ans.attempt_id = a.id
        WHERE q.test_id = _test_id), '[]'::jsonb) END
  )
    INTO _out
    FROM public.students s
    JOIN public.tests t
      ON t.id = _test_id
     AND t.deleted_at IS NULL
     -- Same second statement of the fence as rpc_test_student_report: the gate
     -- says who may read, this says which row exists at all.
     AND t.school_id = s.school_id
    LEFT JOIN public.test_attempts a
           ON a.test_id = _test_id
          AND (a.student_id = s.id OR a.user_id = s.user_id)
          AND a.status = 'submitted'
   WHERE s.id = _student_id;

  RETURN _out;
END;
$function$;

COMMENT ON FUNCTION public.rpc_test_answer_sheet(uuid, uuid) IS
  'One student''s submitted paper: every question with their answer, the key, '
  'the explanation and the time taken. Returns no questions at all until the '
  'attempt is submitted. Fenced by can_read_test_student_report.';

REVOKE ALL ON FUNCTION public.rpc_test_answer_sheet(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_test_answer_sheet(uuid, uuid) TO authenticated;

-- ── Proof ─────────────────────────────────────────────────────────────────
DO $verify$
DECLARE
  _school uuid; _ss uuid; _section uuid; _teacher uuid;
  _stu uuid; _stu_user uuid; _other uuid; _other_user uuid;
  _test uuid; _q1 uuid; _q2 uuid; _att uuid;
  _sheet jsonb; _before jsonb;
  _leaked boolean;
BEGIN
  SELECT ss.school_id, ss.id, ss.section_id, t.user_id
    INTO _school, _ss, _section, _teacher
    FROM public.section_subjects ss
    JOIN public.teacher_classes tc ON tc.class_id = ss.section_id
    JOIN public.teachers t ON t.id = tc.teacher_id AND t.user_id IS NOT NULL AND t.deleted_at IS NULL
    JOIN public.memberships m ON m.local_person_id = t.id AND m.role = 'teacher'
                             AND m.status = 'active' AND m.school_id = ss.school_id
   WHERE (SELECT count(*) FROM public.students s
           WHERE s.class_id = ss.section_id AND s.user_id IS NOT NULL AND s.deleted_at IS NULL) >= 2
   LIMIT 1;

  IF _ss IS NULL THEN
    RAISE EXCEPTION 'ROLLED BACK: need a section with a teacher and two signed-up students';
  END IF;

  SELECT id, user_id INTO _stu, _stu_user FROM public.students
   WHERE class_id = _section AND user_id IS NOT NULL AND deleted_at IS NULL ORDER BY id LIMIT 1;
  SELECT id, user_id INTO _other, _other_user FROM public.students
   WHERE class_id = _section AND user_id IS NOT NULL AND deleted_at IS NULL AND id <> _stu ORDER BY id LIMIT 1;

  INSERT INTO public.tests (school_id, section_subject_id, created_by, title, max_mark, total_marks,
                            status, test_kind, duration_sec, published_at)
  VALUES (_school, _ss, _teacher, '[verify 20260920050000] answer sheet', 2, 2, 'published', 'class_test', 900, now())
  RETURNING id INTO _test;
  INSERT INTO public.test_questions (test_id, school_id, order_index, question_format, question, options, correct, marks, explanation)
  VALUES (_test, _school, 0, 'mcq', 'verify: 7 + 7 ?', '["14","15"]', '{"indexes":[0]}', 1, 'fourteen')
  RETURNING id INTO _q1;
  INSERT INTO public.test_questions (test_id, school_id, order_index, question_format, question, options, correct, marks, explanation)
  VALUES (_test, _school, 1, 'mcq', 'verify: 8 + 8 ?', '["16","17"]', '{"indexes":[0]}', 1, 'sixteen')
  RETURNING id INTO _q2;

  -- 1. BEFORE submitting, the student is REFUSED OUTRIGHT — not handed an empty
  --    payload. `can_read_test_student_report`'s student branch requires
  --    `_test_was_sat_by`, which is the fence 20260916020000 added after a
  --    student read a whole paper with its key before sitting it. This claim
  --    records that the new function inherits it rather than working around it.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _stu_user, 'role','authenticated')::text, true);
  BEGIN
    PERFORM public.rpc_test_answer_sheet(_test, _stu);
    _leaked := true;
  EXCEPTION WHEN insufficient_privilege THEN
    _leaked := false;
  END;
  IF _leaked THEN
    RAISE EXCEPTION 'ROLLED BACK: a student read the paper before sitting it';
  END IF;

  -- 2. The TEACHER may ask before the student has sat it — their branch has no
  --    such condition, because a teacher looking at who has handed in is a
  --    normal thing to do. What they must NOT get is the key attached to an
  --    attempt that does not exist: an empty question list, and `submitted`
  --    false rather than a missing field.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _teacher, 'role','authenticated')::text, true);
  _before := public.rpc_test_answer_sheet(_test, _stu);
  IF (_before ->> 'submitted')::boolean THEN
    RAISE EXCEPTION 'ROLLED BACK: an unsat test reports as submitted';
  END IF;
  IF jsonb_array_length(_before -> 'questions') <> 0 THEN
    RAISE EXCEPTION 'ROLLED BACK: % question(s) came back for an attempt that does not exist',
      jsonb_array_length(_before -> 'questions');
  END IF;

  -- Sit it: first right, second left blank.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _stu_user, 'role','authenticated')::text, true);
  _att := public.rpc_test_start(_test);
  PERFORM public.rpc_test_submit(_att, jsonb_build_array(
    jsonb_build_object('question_id', _q1, 'response', '{"indexes":[0]}'::jsonb, 'time_ms', 5000)));

  -- 3. AFTER submitting, the whole paper comes back with the key and the three
  --    answer states intact — and this is the positive control for claim 1.
  _sheet := public.rpc_test_answer_sheet(_test, _stu);
  IF NOT (_sheet ->> 'submitted')::boolean THEN
    RAISE EXCEPTION 'ROLLED BACK: a submitted attempt reports as not submitted';
  END IF;
  IF jsonb_array_length(_sheet -> 'questions') <> 2 THEN
    RAISE EXCEPTION 'ROLLED BACK: the sheet has % question(s), expected 2', jsonb_array_length(_sheet -> 'questions');
  END IF;
  IF NOT ((_sheet -> 'questions' -> 0 ->> 'is_correct')::boolean)
     OR NOT ((_sheet -> 'questions' -> 0 ->> 'answered')::boolean)
     OR (_sheet -> 'questions' -> 0 -> 'correct_answer') IS NULL
     OR (_sheet -> 'questions' -> 0 ->> 'explanation') IS NULL THEN
    RAISE EXCEPTION 'ROLLED BACK: the answered question is not reviewable: %', _sheet -> 'questions' -> 0;
  END IF;
  IF ((_sheet -> 'questions' -> 1 ->> 'answered')::boolean)
     OR ((_sheet -> 'questions' -> 1 ->> 'is_correct')::boolean)
     OR (_sheet -> 'questions' -> 1 -> 'their_answer') <> 'null'::jsonb THEN
    RAISE EXCEPTION 'ROLLED BACK: the blank question is not reported as blank: %', _sheet -> 'questions' -> 1;
  END IF;
  IF (_sheet ->> 'mark')::numeric <> 1 THEN
    RAISE EXCEPTION 'ROLLED BACK: the sheet reports mark %, expected 1', _sheet ->> 'mark';
  END IF;

  -- 4. A classmate is refused.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _other_user, 'role','authenticated')::text, true);
  BEGIN
    PERFORM public.rpc_test_answer_sheet(_test, _stu);
    _leaked := true;
  EXCEPTION WHEN insufficient_privilege THEN
    _leaked := false;
  END;
  IF _leaked THEN
    RAISE EXCEPTION 'ROLLED BACK: a classmate read this student''s paper';
  END IF;

  -- 5. The teacher of the section may read it — the positive control for 4.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _teacher, 'role','authenticated')::text, true);
  IF jsonb_array_length(public.rpc_test_answer_sheet(_test, _stu) -> 'questions') <> 2 THEN
    RAISE EXCEPTION 'ROLLED BACK: the teacher of this section cannot read the paper they set';
  END IF;
  PERFORM set_config('request.jwt.claims', '', true);

  DELETE FROM public.student_mistakes WHERE source_id = _test;
  DELETE FROM public.test_marks WHERE test_id = _test;
  DELETE FROM public.test_answers WHERE attempt_id = _att;
  DELETE FROM public.test_attempts WHERE test_id = _test;
  DELETE FROM public.test_questions WHERE test_id = _test;
  DELETE FROM public.tests WHERE id = _test;

  RAISE NOTICE 'verify OK: no key before submitting, the full reviewable paper after, blank reported as blank, classmate refused, teacher admitted';
END
$verify$;
