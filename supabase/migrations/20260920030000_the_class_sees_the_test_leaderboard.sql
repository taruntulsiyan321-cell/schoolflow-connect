-- ═══════════════════════════════════════════════════════════════════════════
-- The class sees the test leaderboard (rule 13, product ruling 2026-09-12)
--
-- ── THE RULING THIS BUILDS ───────────────────────────────────────────────
--
--   "The leaderboard shall also be dynamic: if the student has completed the
--    test, the first student to complete the test is already shown at the top.
--    As soon as all the students start submitting, the leaderboard gets
--    updated."
--
-- and rule 13 as corrected on 2026-09-11:
--
--   "Marks and rank are SHARED WITHIN THE CLASS; per-question detail is private
--    to each student."
--
-- What existed before this: `rpc_test_student_report` returns `rank` and
-- `class_size` — a position with no other child in the payload. That was
-- deliberate while a NAMED leaderboard was undecided (20260916030000: "If a
-- NAMED leaderboard was meant, that is a widening of that one field and a
-- disclosure decision — ask before building it."). It has now been asked and
-- ruled, so this is that widening, in its own function, with its own fence.
--
-- ── RANK IS DEFINED ONCE ─────────────────────────────────────────────────
--
--     rank = (number of submitted attempts scoring strictly MORE) + 1
--
-- which is exactly `rpc_test_student_report`'s formula, restated nowhere: the
-- two surfaces must never disagree about a student's position, so both compute
-- it the same way and a tie shares a rank. ORDERING is a separate question from
-- ranking, and the ruling answers it: equal marks are ordered by who finished
-- FIRST. So two students on 3 of 3 are both rank 1, and the one who submitted
-- earlier is the one at the top.
--
-- ── WHO MAY READ IT, AND WHY EACH ────────────────────────────────────────
--
--   a student of that section, ONCE THEY HAVE SUBMITTED
--        Marks are shared within the class (rule 13). The submitted condition
--        is not politeness: without it a student who has not sat the test yet
--        could read the marks of everyone who has, which is both a disclosure
--        they have no claim on and an obvious way to learn how hard the paper
--        is before starting it. `_test_was_sat_by` is the same gate the report
--        and the parent's copy already use.
--   a teacher who teaches that section
--        They already read the whole class report; a ranking of it is strictly
--        less than that.
--   the principal
--        Ruled 2026-09-12: "on the class tab, the principal shall be able to
--        see the test and the marks each student has got." Marks, not
--        per-question detail — which is why this function exists separately
--        from `rpc_test_student_report` and the principal is NOT admitted
--        there (20260920040000 states that split).
--
-- Everyone else is refused, the admin included: the office's stated need is
-- "all the numbers of tests given in the school", which is a count over `tests`
-- that `can_read_test_row` already admits them to, not a named list of one
-- class's marks.
--
-- Rollback: supabase/migrations/rollback/
--           20260920030000_the_class_sees_the_test_leaderboard.rollback.sql
-- Assertion: supabase/migrations/verification/caller-privileges/probe44.sql
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.can_read_test_leaderboard(_test_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
      FROM public.tests t
      JOIN public.section_subjects ss ON ss.id = t.section_subject_id
     WHERE t.id = _test_id
       AND t.deleted_at IS NULL
       AND t.school_id IN (SELECT public.my_accessible_school_ids())
       AND (
         -- the teachers of that section
         public.teacher_teaches_class((SELECT auth.uid()), ss.section_id)
         -- the principal of that school: marks, by the 2026-09-12 ruling
         OR (SELECT public.has_role((SELECT auth.uid()), 'principal'::public.app_role))
         -- a student of that section who has already handed the paper in
         OR EXISTS (
              SELECT 1 FROM public.students s
               WHERE s.class_id = ss.section_id
                 AND s.school_id = t.school_id
                 AND s.user_id = (SELECT auth.uid())
                 AND s.deleted_at IS NULL
                 AND public._test_was_sat_by(_test_id, s.id)
            )
       )
  )
$function$;

COMMENT ON FUNCTION public.can_read_test_leaderboard(uuid) IS
  'Sole authority for who may read a test leaderboard: the teachers of that '
  'section, the principal (marks only, 2026-09-12 ruling), and a student of '
  'the section who has submitted. Admin is deliberately out — see 20260920030000.';

CREATE OR REPLACE FUNCTION public.rpc_test_leaderboard(_test_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _out jsonb;
BEGIN
  IF NOT public.can_read_test_leaderboard(_test_id) THEN
    RAISE EXCEPTION 'Not your class''s test leaderboard' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'test_id', t.id,
    'title', t.title,
    'max_mark', t.max_mark,
    'subject', cs.name,
    -- How many have handed in, and how many could. Both, because "7 of 32
    -- submitted" is the fact a teacher acts on and a single number hides it.
    'submitted_count', (SELECT count(*) FROM public.test_attempts a
                         WHERE a.test_id = t.id AND a.status = 'submitted'),
    'roll_count', (SELECT count(*) FROM public.students s
                    WHERE s.class_id = ss.section_id
                      AND s.school_id = t.school_id
                      AND s.deleted_at IS NULL),
    'entries', COALESCE((
      SELECT jsonb_agg(e ORDER BY e.mark DESC, e.submitted_at ASC, e.full_name ASC)
        FROM (
          SELECT s.id AS student_id,
                 s.full_name,
                 sc.roll_number,
                 a.score AS mark,
                 a.correct_count,
                 a.total_count,
                 a.submitted_at,
                 -- The same definition as rpc_test_student_report.rank, so the
                 -- position a student reads on their own result and the one
                 -- they read here can never disagree. Ties share a rank.
                 (SELECT count(*) + 1 FROM public.test_attempts a2
                   WHERE a2.test_id = t.id
                     AND a2.status = 'submitted'
                     AND a2.score > a.score) AS rank,
                 (s.user_id = (SELECT auth.uid())) AS is_me
            FROM public.test_attempts a
            JOIN public.students s
              ON (a.student_id = s.id OR a.user_id = s.user_id)
             AND s.school_id = t.school_id
             AND s.deleted_at IS NULL
            LEFT JOIN public.students_current sc ON sc.id = s.id
           WHERE a.test_id = t.id
             AND a.status = 'submitted'
        ) e), '[]'::jsonb)
  )
    INTO _out
    FROM public.tests t
    JOIN public.section_subjects ss ON ss.id = t.section_subject_id
    LEFT JOIN public.curriculum_subjects cs ON cs.id = ss.curriculum_subject_id
   WHERE t.id = _test_id AND t.deleted_at IS NULL;

  RETURN _out;
END;
$function$;

COMMENT ON FUNCTION public.rpc_test_leaderboard(uuid) IS
  'The per-test leaderboard: every submitted attempt ranked, ordered by mark '
  'then by who finished first. Fenced by can_read_test_leaderboard.';

REVOKE ALL ON FUNCTION public.can_read_test_leaderboard(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rpc_test_leaderboard(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_read_test_leaderboard(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_test_leaderboard(uuid) TO authenticated;

-- ── Proof ─────────────────────────────────────────────────────────────────
DO $verify$
DECLARE
  _school uuid; _ss uuid; _section uuid; _teacher uuid;
  _stu1 uuid; _stu1_user uuid; _stu2 uuid; _stu2_user uuid;
  _test uuid; _q1 uuid; _q2 uuid; _a1 uuid; _a2 uuid;
  _lb jsonb; _first jsonb; _second jsonb;
  _refused boolean := false;
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
    RAISE EXCEPTION 'ROLLED BACK: no section with a teacher and two signed-up students — the ordering claim needs two';
  END IF;

  SELECT id, user_id INTO _stu1, _stu1_user FROM public.students
   WHERE class_id = _section AND user_id IS NOT NULL AND deleted_at IS NULL ORDER BY id LIMIT 1;
  SELECT id, user_id INTO _stu2, _stu2_user FROM public.students
   WHERE class_id = _section AND user_id IS NOT NULL AND deleted_at IS NULL AND id <> _stu1 ORDER BY id LIMIT 1;

  INSERT INTO public.tests (school_id, section_subject_id, created_by, title, max_mark, total_marks,
                            status, test_kind, duration_sec, published_at)
  VALUES (_school, _ss, _teacher, '[verify 20260920030000] leaderboard', 2, 2, 'published', 'class_test', 1800, now())
  RETURNING id INTO _test;

  INSERT INTO public.test_questions (test_id, school_id, order_index, question_format, question, options, correct, marks)
  VALUES (_test, _school, 0, 'mcq', 'verify: 1 + 1 ?', '["1","2"]', '{"indexes":[1]}', 1) RETURNING id INTO _q1;
  INSERT INTO public.test_questions (test_id, school_id, order_index, question_format, question, options, correct, marks)
  VALUES (_test, _school, 1, 'mcq', 'verify: 2 + 2 ?', '["4","5"]', '{"indexes":[0]}', 1) RETURNING id INTO _q2;

  -- Student 1 submits FIRST, with one of two right.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _stu1_user, 'role','authenticated')::text, true);
  _a1 := public.rpc_test_start(_test);
  PERFORM public.rpc_test_submit(_a1, jsonb_build_array(
    jsonb_build_object('question_id', _q1, 'response', '{"indexes":[1]}'::jsonb),
    jsonb_build_object('question_id', _q2, 'response', '{"indexes":[1]}'::jsonb)));

  -- While they are the only submitter, they are at the top.
  _lb := public.rpc_test_leaderboard(_test);
  IF jsonb_array_length(_lb -> 'entries') <> 1
     OR ((_lb -> 'entries' -> 0 ->> 'rank')::int) <> 1
     OR NOT ((_lb -> 'entries' -> 0 ->> 'is_me')::boolean) THEN
    RAISE EXCEPTION 'ROLLED BACK: the only submitter is not shown first as themselves: %', _lb -> 'entries';
  END IF;

  -- Student 2 submits SECOND, with both right — so they take the top by mark.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _stu2_user, 'role','authenticated')::text, true);
  _a2 := public.rpc_test_start(_test);
  PERFORM public.rpc_test_submit(_a2, jsonb_build_array(
    jsonb_build_object('question_id', _q1, 'response', '{"indexes":[1]}'::jsonb),
    jsonb_build_object('question_id', _q2, 'response', '{"indexes":[0]}'::jsonb)));

  _lb := public.rpc_test_leaderboard(_test);
  _first  := _lb -> 'entries' -> 0;
  _second := _lb -> 'entries' -> 1;

  IF jsonb_array_length(_lb -> 'entries') <> 2 THEN
    RAISE EXCEPTION 'ROLLED BACK: % entries after two submissions', jsonb_array_length(_lb -> 'entries');
  END IF;
  IF (_first ->> 'student_id')::uuid <> _stu2 OR (_first ->> 'rank')::int <> 1 THEN
    RAISE EXCEPTION 'ROLLED BACK: the higher mark is not rank 1 at the top: %', _first;
  END IF;
  IF (_second ->> 'student_id')::uuid <> _stu1 OR (_second ->> 'rank')::int <> 2 THEN
    RAISE EXCEPTION 'ROLLED BACK: the lower mark is not second: %', _second;
  END IF;
  IF (_lb ->> 'submitted_count')::int <> 2 THEN
    RAISE EXCEPTION 'ROLLED BACK: submitted_count is %, expected 2', _lb ->> 'submitted_count';
  END IF;
  IF (_lb ->> 'roll_count')::int < 2 THEN
    RAISE EXCEPTION 'ROLLED BACK: roll_count is %, expected at least 2', _lb ->> 'roll_count';
  END IF;

  -- The teacher of the section reads the same board. (Positive control for the
  -- fence: without it, a function refusing everyone would satisfy nothing here
  -- but the student branch.)
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _teacher, 'role','authenticated')::text, true);
  IF NOT public.can_read_test_leaderboard(_test) THEN
    RAISE EXCEPTION 'ROLLED BACK: the teacher of this section cannot read its leaderboard';
  END IF;

  -- A signed-out caller cannot.
  PERFORM set_config('request.jwt.claims', '', true);
  IF public.can_read_test_leaderboard(_test) THEN
    RAISE EXCEPTION 'ROLLED BACK: a caller with no session was admitted';
  END IF;

  -- Clean up.
  DELETE FROM public.student_mistakes WHERE source_id = _test;
  DELETE FROM public.test_marks WHERE test_id = _test;
  DELETE FROM public.test_answers WHERE attempt_id IN (_a1, _a2);
  DELETE FROM public.test_attempts WHERE test_id = _test;
  DELETE FROM public.test_questions WHERE test_id = _test;
  DELETE FROM public.tests WHERE id = _test;

  RAISE NOTICE 'verify OK: first submitter led alone, the higher mark took rank 1, the teacher reads it, a signed-out caller does not';
END
$verify$;
