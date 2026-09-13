-- ═══════════════════════════════════════════════════════════════════════════
-- The report says WHICH question cost the class its time (§10.25)
--
-- ── WHAT THE REPORT SAID BEFORE ───────────────────────────────────────────
--
-- `rpc_test_class_report` returned ONE timing number for a whole paper:
--
--     'average_seconds_per_question', round(avg(a.time_spent_sec) / count(q))
--
-- That is the paper's mean divided by its length. It cannot distinguish a
-- paper where every question took 40 seconds from one where nineteen took ten
-- and the twentieth took twelve minutes — and the second is the only one a
-- teacher can act on, because it names the question to re-teach.
--
-- ── WHAT THIS ADDS ────────────────────────────────────────────────────────
--
-- `rpc_test_question_breakdown(_test_id)` — one row per question, in paper
-- order, each carrying:
--
--   answered / correct / wrong / blank   the four states, counted separately
--   avg_time_ms, max_time_ms             what it cost, measured per answer
--   slowest_student_id / _name / _ms     who it cost the most, by name
--
-- `test_answers.time_ms` has been landed per answer since 20260920000000, and
-- the attempt clock (`time_spent_sec`) is the sum the old number divided. This
-- reads the per-answer column the submit RPC already writes; nothing new is
-- recorded and no existing caller changes.
--
-- ── NULL IS NOT ZERO, FOUR TIMES OVER (§7, G4) ────────────────────────────
--
-- An answer written before the per-question clock existed has `time_ms IS
-- NULL`. Averaging those as zero would report the paper getting faster the
-- older it is. So:
--
--   * avg_time_ms / max_time_ms are NULL when NOTHING on that question was
--     timed, and average only the rows that were — `timed_count` says how many
--     that is, so the screen can say "3 of 28 timed" instead of implying 28.
--   * slowest_* are all NULL together when no timed answer exists. A name with
--     no time, or a time with no name, is not a fact.
--   * blank_count is submitted attempts MINUS answered, computed from the
--     attempt count, not from absent rows — a question nobody reached and a
--     question nobody sat are different numbers.
--
-- ── THE FENCE IS THE ONE THAT ALREADY DECIDES THIS ────────────────────────
--
-- `can_read_test_report(_test_id)`: the teachers of the section, the test's
-- author, and admin. This is the same paper-level detail `rpc_test_class_report`
-- returns and it is fenced identically — restating the predicate here would be
-- the same rule in two homes (G9). The principal is refused, exactly as they
-- are refused the class report today (see 20260916000000's header); the
-- principal's surface is `rpc_test_class_marks`, which this does not touch.
--
-- Rollback: supabase/migrations/rollback/
--           20260921000000_the_report_says_which_question_cost_the_class_its_time.rollback.sql
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.rpc_test_question_breakdown(_test_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _out jsonb; _submitted int;
BEGIN
  IF NOT public.can_read_test_report(_test_id) THEN
    RAISE EXCEPTION 'Not your test to report on' USING ERRCODE = '42501';
  END IF;

  SELECT count(*) INTO _submitted
    FROM public.test_attempts a
   WHERE a.test_id = _test_id AND a.status = 'submitted';

  SELECT jsonb_build_object(
    'test_id', t.id,
    'title', t.title,
    'max_mark', t.max_mark,
    'submitted_count', _submitted,
    'questions', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'question_id', q.id,
               'order_index', q.order_index,
               'question', q.question,
               'question_format', q.question_format,
               'marks', q.marks,
               'topic', COALESCE(NULLIF(btrim(q.concept), ''), NULLIF(btrim(q.chapter), ''), 'Unlabelled'),
               'answered_count', st.answered,
               'correct_count', st.correct,
               'wrong_count', st.answered - st.correct,
               -- Nobody reached it is not nobody sat it.
               'blank_count', GREATEST(_submitted - st.answered, 0),
               'timed_count', st.timed,
               'avg_time_ms', st.avg_ms,
               'max_time_ms', st.max_ms,
               'slowest_student_id', sl.student_id,
               'slowest_student_name', sl.full_name,
               'slowest_time_ms', sl.time_ms
             ) ORDER BY q.order_index)
        FROM public.test_questions q
        -- The four counts and the two averages, per question, over SUBMITTED
        -- attempts only: a paper still open is not a result.
        CROSS JOIN LATERAL (
          SELECT count(ans.id)::int AS answered,
                 count(*) FILTER (WHERE ans.is_correct)::int AS correct,
                 count(ans.time_ms)::int AS timed,
                 -- avg() over an all-NULL set is NULL, which is the answer.
                 round(avg(ans.time_ms))::bigint AS avg_ms,
                 max(ans.time_ms)::bigint AS max_ms
            FROM public.test_answers ans
            JOIN public.test_attempts a ON a.id = ans.attempt_id
                                       AND a.test_id = _test_id
                                       AND a.status = 'submitted'
           WHERE ans.question_id = q.id
        ) st
        -- Who it cost the most. NULL for every column together when no answer
        -- on this question carries a time.
        LEFT JOIN LATERAL (
          SELECT s.id AS student_id, s.full_name, ans.time_ms
            FROM public.test_answers ans
            JOIN public.test_attempts a ON a.id = ans.attempt_id
                                       AND a.test_id = _test_id
                                       AND a.status = 'submitted'
            JOIN public.students s ON (a.student_id = s.id OR a.user_id = s.user_id)
                                  AND s.school_id = t.school_id
                                  AND s.deleted_at IS NULL
           WHERE ans.question_id = q.id AND ans.time_ms IS NOT NULL
           ORDER BY ans.time_ms DESC, s.full_name ASC
           LIMIT 1
        ) sl ON true
       WHERE q.test_id = _test_id), '[]'::jsonb)
  )
    INTO _out
    FROM public.tests t
   WHERE t.id = _test_id AND t.deleted_at IS NULL;

  RETURN _out;
END;
$function$;

COMMENT ON FUNCTION public.rpc_test_question_breakdown(uuid) IS
  'Per-question outcome and timing for one test: answered/correct/wrong/blank, '
  'average and longest time, and the student it cost the most. Fenced by '
  'can_read_test_report — the same readers as the class report.';

REVOKE ALL ON FUNCTION public.rpc_test_question_breakdown(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_test_question_breakdown(uuid) TO authenticated;

-- ── Proof, as the callers ─────────────────────────────────────────────────
DO $verify$
DECLARE
  _school uuid; _ss uuid; _section uuid; _teacher uuid; _principal uuid;
  _s1 uuid; _u1 uuid; _s2 uuid; _u2 uuid;
  _test uuid; _qa uuid; _qb uuid; _att uuid; _out jsonb; _qs jsonb;
  _fast jsonb; _slow jsonb; _refused boolean := false;
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
  SELECT id, user_id INTO _s1, _u1 FROM public.students
   WHERE class_id = _section AND user_id IS NOT NULL AND deleted_at IS NULL ORDER BY id LIMIT 1;
  SELECT id, user_id INTO _s2, _u2 FROM public.students
   WHERE class_id = _section AND user_id IS NOT NULL AND deleted_at IS NULL AND id <> _s1 ORDER BY id LIMIT 1;
  SELECT m.account_id INTO _principal FROM public.memberships m
   WHERE m.role = 'principal' AND m.status = 'active' AND m.school_id = _school LIMIT 1;

  IF _s2 IS NULL THEN
    RAISE EXCEPTION 'ROLLED BACK: need two signed-up students in one section';
  END IF;

  INSERT INTO public.tests (school_id, section_subject_id, created_by, title, max_mark, total_marks,
                            status, test_kind, duration_sec, published_at)
  VALUES (_school, _ss, _teacher, '[verify 20260921000000] where the time went', 2, 2,
          'published', 'class_test', 600, now())
  RETURNING id INTO _test;
  INSERT INTO public.test_questions (test_id, school_id, order_index, question_format, question, options, correct, marks, concept)
  VALUES (_test, _school, 0, 'mcq', 'verify: the quick one', '["2","3"]', '{"indexes":[0]}', 1, 'Quick')
  RETURNING id INTO _qa;
  INSERT INTO public.test_questions (test_id, school_id, order_index, question_format, question, options, correct, marks, concept)
  VALUES (_test, _school, 1, 'mcq', 'verify: the one that cost them', '["7","8"]', '{"indexes":[1]}', 1, 'Costly')
  RETURNING id INTO _qb;

  -- Student 1: quick on Q1 (right), slow on Q2 (right).
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _u1, 'role','authenticated')::text, true);
  _att := public.rpc_test_start(_test);
  PERFORM public.rpc_test_submit(_att, jsonb_build_array(
    jsonb_build_object('question_id', _qa, 'response', '{"indexes":[0]}'::jsonb, 'time_ms', 4000),
    jsonb_build_object('question_id', _qb, 'response', '{"indexes":[1]}'::jsonb, 'time_ms', 90000)));

  -- Student 2: quick on Q1 (wrong), slower still on Q2 (wrong). Leaves nothing
  -- blank, so the blank count below has to come from the third student, who
  -- never sat it at all.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _u2, 'role','authenticated')::text, true);
  _att := public.rpc_test_start(_test);
  PERFORM public.rpc_test_submit(_att, jsonb_build_array(
    jsonb_build_object('question_id', _qa, 'response', '{"indexes":[1]}'::jsonb, 'time_ms', 6000)));

  PERFORM set_config('request.jwt.claims', json_build_object('sub', _teacher, 'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  _out := public.rpc_test_question_breakdown(_test);
  RESET ROLE;

  _qs := _out -> 'questions';
  IF jsonb_array_length(_qs) <> 2 THEN
    RAISE EXCEPTION 'ROLLED BACK: breakdown returned % questions, expected 2', jsonb_array_length(_qs);
  END IF;
  _fast := _qs -> 0;
  _slow := _qs -> 1;

  -- 1. The paper order is the report order.
  IF (_fast ->> 'question_id') <> _qa::text OR (_slow ->> 'question_id') <> _qb::text THEN
    RAISE EXCEPTION 'ROLLED BACK: questions came back out of paper order';
  END IF;

  -- 2. The timing is PER QUESTION and the two disagree — the whole point.
  IF (_fast ->> 'avg_time_ms')::bigint <> 5000 THEN
    RAISE EXCEPTION 'ROLLED BACK: Q1 average was %, expected 5000', _fast ->> 'avg_time_ms';
  END IF;
  IF (_slow ->> 'avg_time_ms')::bigint <> 90000 THEN
    RAISE EXCEPTION 'ROLLED BACK: Q2 average was %, expected 90000', _slow ->> 'avg_time_ms';
  END IF;
  IF (_slow ->> 'avg_time_ms')::bigint <= (_fast ->> 'avg_time_ms')::bigint THEN
    RAISE EXCEPTION 'ROLLED BACK: the costly question did not read as costlier';
  END IF;

  -- 3. It names who it cost the most, and that is the student who took it.
  IF (_slow ->> 'slowest_student_id') <> _s1::text THEN
    RAISE EXCEPTION 'ROLLED BACK: slowest on Q2 was %, expected %', _slow ->> 'slowest_student_id', _s1;
  END IF;
  IF (_slow ->> 'slowest_student_name') IS NULL OR (_slow ->> 'slowest_time_ms')::bigint <> 90000 THEN
    RAISE EXCEPTION 'ROLLED BACK: the slowest entry is half a fact (name=%, ms=%)',
      _slow ->> 'slowest_student_name', _slow ->> 'slowest_time_ms';
  END IF;

  -- 4. Four states, counted apart. Two sat it; both answered Q1, one of them
  --    right; only one reached Q2, so the other's Q2 is blank, not wrong.
  IF (_fast ->> 'answered_count')::int <> 2 OR (_fast ->> 'correct_count')::int <> 1
     OR (_fast ->> 'wrong_count')::int <> 1 OR (_fast ->> 'blank_count')::int <> 0 THEN
    RAISE EXCEPTION 'ROLLED BACK: Q1 counts were answered=%, correct=%, wrong=%, blank=%',
      _fast ->> 'answered_count', _fast ->> 'correct_count', _fast ->> 'wrong_count', _fast ->> 'blank_count';
  END IF;
  IF (_slow ->> 'answered_count')::int <> 1 OR (_slow ->> 'blank_count')::int <> 1
     OR (_slow ->> 'wrong_count')::int <> 0 THEN
    RAISE EXCEPTION 'ROLLED BACK: Q2 counts were answered=%, wrong=%, blank=%',
      _slow ->> 'answered_count', _slow ->> 'wrong_count', _slow ->> 'blank_count';
  END IF;

  -- 5. An untimed answer is not a zero-second answer. Clear the clock on one
  --    row of Q1 and the average must move to the other row alone, not halve.
  UPDATE public.test_answers ans SET time_ms = NULL
    FROM public.test_attempts a
   WHERE ans.attempt_id = a.id AND a.test_id = _test AND ans.question_id = _qa
     AND ans.time_ms = 6000;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _teacher, 'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  _out := public.rpc_test_question_breakdown(_test);
  RESET ROLE;
  _fast := (_out -> 'questions') -> 0;
  IF (_fast ->> 'avg_time_ms')::bigint <> 4000 OR (_fast ->> 'timed_count')::int <> 1
     OR (_fast ->> 'answered_count')::int <> 2 THEN
    RAISE EXCEPTION 'ROLLED BACK: an untimed answer was averaged as zero (avg=%, timed=%, answered=%)',
      _fast ->> 'avg_time_ms', _fast ->> 'timed_count', _fast ->> 'answered_count';
  END IF;

  -- 6. And with NO timing at all, the timing columns are NULL, not 0.
  UPDATE public.test_answers ans SET time_ms = NULL
    FROM public.test_attempts a
   WHERE ans.attempt_id = a.id AND a.test_id = _test AND ans.question_id = _qa;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _teacher, 'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  _out := public.rpc_test_question_breakdown(_test);
  RESET ROLE;
  _fast := (_out -> 'questions') -> 0;
  IF (_fast -> 'avg_time_ms') <> 'null'::jsonb OR (_fast -> 'slowest_student_id') <> 'null'::jsonb
     OR (_fast -> 'slowest_time_ms') <> 'null'::jsonb THEN
    RAISE EXCEPTION 'ROLLED BACK: an untimed question reported a time (avg=%, who=%)',
      _fast -> 'avg_time_ms', _fast -> 'slowest_student_id';
  END IF;

  -- 7. FENCE: the student who sat it cannot read the class's per-question
  --    breakdown, and the principal is refused here exactly as they are
  --    refused the class report.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _u1, 'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.rpc_test_question_breakdown(_test);
  EXCEPTION WHEN insufficient_privilege THEN _refused := true;
  END;
  RESET ROLE;
  IF NOT _refused THEN
    RAISE EXCEPTION 'ROLLED BACK: a student read the class per-question breakdown';
  END IF;

  IF _principal IS NOT NULL THEN
    _refused := false;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', _principal, 'role','authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    BEGIN
      PERFORM public.rpc_test_question_breakdown(_test);
    EXCEPTION WHEN insufficient_privilege THEN _refused := true;
    END;
    RESET ROLE;
    IF NOT _refused THEN
      RAISE EXCEPTION 'ROLLED BACK: the principal read the teacher-only breakdown';
    END IF;
  END IF;

  PERFORM set_config('request.jwt.claims', '', true);

  DELETE FROM public.student_mistakes WHERE source_id = _test;
  DELETE FROM public.test_marks WHERE test_id = _test;
  DELETE FROM public.test_answers WHERE attempt_id IN
    (SELECT id FROM public.test_attempts WHERE test_id = _test);
  DELETE FROM public.test_attempts WHERE test_id = _test;
  DELETE FROM public.test_questions WHERE test_id = _test;
  DELETE FROM public.tests WHERE id = _test;

  RAISE NOTICE 'verify OK: per-question timing, the slowest student by name, four counts apart, NULL kept NULL, fence closed';
END
$verify$;
