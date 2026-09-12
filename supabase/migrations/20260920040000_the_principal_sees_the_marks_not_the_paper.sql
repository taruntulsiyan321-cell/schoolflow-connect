-- ═══════════════════════════════════════════════════════════════════════════
-- The principal sees the marks, not the paper (product ruling 2026-09-12)
--
-- ── THE RULING, AND THE ONE IT SUPERSEDES ────────────────────────────────
--
-- 2026-09-12, in the product owner's own words:
--
--   "For the principal, we have to build something like this: on the class tab,
--    the principal shall be able to see the test and the marks each student has
--    got. For the admins, we have to build all the numbers of tests given in
--    the school."
--
-- This supersedes the 2026-09-09 ruling recorded in HANDOFF.md §9 — "Admin and
-- Principal sees nothing. Teacher get a test report. Student get their own
-- reports plus leaderboard. Parents get their own child reports." — which
-- `20260916030000` implemented by removing both office branches from
-- `can_read_test_report`. That is stated plainly rather than quietly reversed:
-- the earlier ruling is not wrong history, it is a decision that changed, and
-- the next session needs to know which one is current.
--
-- ── WHAT IS GRANTED, AND WHAT IS STILL WITHHELD ──────────────────────────
--
-- Granted to the principal: THE MARKS. The test, who sat it, what each student
-- scored, out of what, and the class average.
--
-- Still withheld from the principal: THE PAPER. Which questions a named child
-- got wrong, what they answered, and which topics the class found hard. Rule 13
-- is unchanged on that point — "per-question detail is private to each student"
-- — and the ruling asked for marks, not for the report. So:
--
--   rpc_test_class_marks    NEW.  test + per-student marks + average.
--                                 Fence: can_read_test_marks — the teachers of
--                                 the section, OR the principal of the school.
--   rpc_test_class_report   the teacher's report: the marks list PLUS weakest
--                                 topics and timing. Fence UNCHANGED
--                                 (can_read_test_report), so the principal is
--                                 still refused here.
--   rpc_test_student_report the per-question drill-down. Fence UNCHANGED, so
--                                 the principal is still refused here too.
--
-- ── ONE DEFINITION OF THE MARKS LIST (G9) ────────────────────────────────
--
-- The class report ALREADY built a student list with marks inside its own body.
-- Adding a second function that builds the same list from the same tables would
-- be the same fact in two homes, and the two would drift the first time one was
-- touched. So the marks list moves into `rpc_test_class_marks` and the class
-- report now COMPOSES it:
--
--     rpc_test_class_report = rpc_test_class_marks || { weakest_topics,
--                                                       average_seconds_per_question }
--
-- Same payload keys as before — `TestClassReport` in testService.ts is
-- unchanged and the teacher's screen cannot tell the difference — and there is
-- exactly one query that decides what a student scored on a test.
--
-- The composition is safe in fence terms because the report's own fence is the
-- NARROWER of the two: a caller who passes `can_read_test_report` always passes
-- `can_read_test_marks`. It is asserted in that order (report fence first, then
-- delegate), so a principal reaching the report is refused by the report before
-- the marks function is ever consulted.
--
-- Rollback: supabase/migrations/rollback/
--           20260920040000_the_principal_sees_the_marks_not_the_paper.rollback.sql
-- Assertion: supabase/migrations/verification/caller-privileges/probe43.sql
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.can_read_test_marks(_test_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  -- The teachers of the section, exactly as the report defines them, plus the
  -- principal of that school. Delegating to can_read_test_report rather than
  -- restating its predicate keeps one description of "the teachers of this
  -- section" (G9).
  SELECT public.can_read_test_report(_test_id)
      OR EXISTS (
           SELECT 1
             FROM public.tests t
            WHERE t.id = _test_id
              AND t.deleted_at IS NULL
              AND t.school_id IN (SELECT public.my_accessible_school_ids())
              AND (SELECT public.has_role((SELECT auth.uid()), 'principal'::public.app_role))
         )
$function$;

COMMENT ON FUNCTION public.can_read_test_marks(uuid) IS
  'Who may read what a class scored on a test: the teachers of that section, '
  'or the principal of that school (2026-09-12 ruling). NOT the per-question '
  'detail — that stays on can_read_test_report / can_read_test_student_report.';

-- ── The marks list: one home ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_test_class_marks(_test_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _out jsonb;
BEGIN
  IF NOT public.can_read_test_marks(_test_id) THEN
    RAISE EXCEPTION 'Not your class''s test marks' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'test_id', t.id,
    'title', t.title,
    'max_mark', t.max_mark,
    'subject', cs.name,
    'class_id', ss.section_id,
    'submitted_count', (SELECT count(*) FROM public.test_attempts a
                         WHERE a.test_id = t.id AND a.status = 'submitted'),
    -- NULL when nobody has submitted. A class average of 0 and "nobody sat it
    -- yet" are different facts and must not render the same (G4).
    'class_average', (SELECT round(avg(a.score)::numeric, 2) FROM public.test_attempts a
                       WHERE a.test_id = t.id AND a.status = 'submitted'),
    -- Full student list. A student who never sat it appears with a NULL mark,
    -- not a zero — "not marked" is never 0 (§7).
    'students', COALESCE((
       SELECT jsonb_agg(y ORDER BY y.full_name) FROM (
         SELECT s.id AS student_id, s.full_name, sc.roll_number,
                a.score AS mark, a.correct_count, a.total_count,
                a.submitted_at,
                (a.id IS NOT NULL AND a.status = 'submitted') AS submitted
           FROM public.students s
           LEFT JOIN public.students_current sc ON sc.id = s.id
           LEFT JOIN public.test_attempts a
                  ON a.test_id = t.id
                 AND (a.student_id = s.id OR a.user_id = s.user_id)
                 AND a.status = 'submitted'
          WHERE s.class_id = ss.section_id
            AND s.school_id = t.school_id
            AND s.deleted_at IS NULL
       ) y), '[]'::jsonb)
  )
    INTO _out
    FROM public.tests t
    JOIN public.section_subjects ss ON ss.id = t.section_subject_id
    LEFT JOIN public.curriculum_subjects cs ON cs.id = ss.curriculum_subject_id
   WHERE t.id = _test_id AND t.deleted_at IS NULL;

  RETURN _out;
END;
$function$;

COMMENT ON FUNCTION public.rpc_test_class_marks(uuid) IS
  'The test and what each student of the section scored. The only definition of '
  'that list: rpc_test_class_report composes this and adds its topic ranking.';

-- ── The teacher's report: the same list, plus what only they may see ──────
CREATE OR REPLACE FUNCTION public.rpc_test_class_report(_test_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _out jsonb;
BEGIN
  -- The NARROWER fence, asserted first: a principal is refused here before
  -- rpc_test_class_marks (which would admit them) is ever called.
  IF NOT public.can_read_test_report(_test_id) THEN
    RAISE EXCEPTION 'Not your class''s test report' USING ERRCODE = '42501';
  END IF;

  SELECT public.rpc_test_class_marks(_test_id) || jsonb_build_object(
    'average_seconds_per_question', (
       SELECT round((avg(ans.time_ms) / 1000.0)::numeric, 1)
         FROM public.test_answers ans
         JOIN public.test_attempts a ON a.id = ans.attempt_id
        WHERE a.test_id = t.id AND ans.time_ms IS NOT NULL),
    -- Weakest topics ranked. Only what went wrong is ranked — the product
    -- surfaces weaknesses, never strengths (§10.8's ruling on strength display).
    'weakest_topics', COALESCE((
       SELECT jsonb_agg(x) FROM (
         SELECT COALESCE(NULLIF(btrim(q.concept), ''), NULLIF(btrim(q.chapter), ''), 'Unlabelled') AS topic,
                count(*)::int AS asked,
                count(*) FILTER (WHERE COALESCE(ans.is_correct, false) = false)::int AS wrong,
                round(100.0 * count(*) FILTER (WHERE COALESCE(ans.is_correct, false) = false)
                      / NULLIF(count(*), 0), 1) AS wrong_pct
           FROM public.test_questions q
           JOIN public.test_attempts a ON a.test_id = q.test_id AND a.status = 'submitted'
           LEFT JOIN public.test_answers ans ON ans.question_id = q.id AND ans.attempt_id = a.id
          WHERE q.test_id = t.id
          GROUP BY 1
          HAVING count(*) FILTER (WHERE COALESCE(ans.is_correct, false) = false) > 0
          ORDER BY wrong_pct DESC, wrong DESC
       ) x), '[]'::jsonb)
  )
    INTO _out
    FROM public.tests t
   WHERE t.id = _test_id AND t.deleted_at IS NULL;

  RETURN _out;
END;
$function$;

REVOKE ALL ON FUNCTION public.can_read_test_marks(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rpc_test_class_marks(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_read_test_marks(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_test_class_marks(uuid) TO authenticated;

-- ── Proof ─────────────────────────────────────────────────────────────────
DO $verify$
DECLARE
  _school uuid; _ss uuid; _section uuid; _teacher uuid;
  _principal uuid; _stu uuid; _stu_user uuid;
  _test uuid; _q uuid; _att uuid;
  _marks jsonb; _report jsonb;
  _principal_read_report boolean; _principal_read_drill boolean;
BEGIN
  SELECT ss.school_id, ss.id, ss.section_id, t.user_id
    INTO _school, _ss, _section, _teacher
    FROM public.section_subjects ss
    JOIN public.teacher_classes tc ON tc.class_id = ss.section_id
    JOIN public.teachers t ON t.id = tc.teacher_id AND t.user_id IS NOT NULL AND t.deleted_at IS NULL
    JOIN public.memberships m ON m.local_person_id = t.id AND m.role = 'teacher'
                             AND m.status = 'active' AND m.school_id = ss.school_id
   LIMIT 1;

  SELECT m.account_id INTO _principal
    FROM public.memberships m
   WHERE m.role = 'principal' AND m.status = 'active' AND m.school_id = _school
   LIMIT 1;

  SELECT s.id, s.user_id INTO _stu, _stu_user
    FROM public.students s
   WHERE s.class_id = _section AND s.user_id IS NOT NULL AND s.deleted_at IS NULL
   LIMIT 1;

  IF _ss IS NULL OR _principal IS NULL OR _stu IS NULL THEN
    RAISE EXCEPTION 'ROLLED BACK: need a section with a teacher, an active principal and a signed-up student (ss=%, principal=%, student=%)',
      _ss, _principal, _stu;
  END IF;

  INSERT INTO public.tests (school_id, section_subject_id, created_by, title, max_mark, total_marks,
                            status, test_kind, duration_sec, published_at)
  VALUES (_school, _ss, _teacher, '[verify 20260920040000] principal marks', 1, 1, 'published', 'class_test', 600, now())
  RETURNING id INTO _test;
  INSERT INTO public.test_questions (test_id, school_id, order_index, question_format, question, options, correct, marks, concept)
  VALUES (_test, _school, 0, 'mcq', 'verify: 5 + 5 ?', '["10","11"]', '{"indexes":[0]}', 1, 'Addition')
  RETURNING id INTO _q;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', _stu_user, 'role','authenticated')::text, true);
  _att := public.rpc_test_start(_test);
  PERFORM public.rpc_test_submit(_att, jsonb_build_array(
    jsonb_build_object('question_id', _q, 'response', '{"indexes":[0]}'::jsonb, 'time_ms', 3000)));

  -- ── As the principal ────────────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _principal, 'role','authenticated')::text, true);

  -- 1. They read the marks.
  _marks := public.rpc_test_class_marks(_test);
  IF (_marks ->> 'submitted_count')::int <> 1 THEN
    RAISE EXCEPTION 'ROLLED BACK: the principal reads submitted_count %, expected 1', _marks ->> 'submitted_count';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(_marks -> 'students') s
     WHERE (s ->> 'student_id')::uuid = _stu AND (s ->> 'mark')::numeric = 1
  ) THEN
    RAISE EXCEPTION 'ROLLED BACK: the principal cannot see the mark this student got: %', _marks -> 'students';
  END IF;

  -- 2. They are still refused the report and the per-question drill-down.
  BEGIN
    PERFORM public.rpc_test_class_report(_test);
    _principal_read_report := true;
  EXCEPTION WHEN insufficient_privilege THEN
    _principal_read_report := false;
  END;
  IF _principal_read_report THEN
    RAISE EXCEPTION 'ROLLED BACK: the principal read the teacher''s report — topics and timing are not theirs';
  END IF;

  BEGIN
    PERFORM public.rpc_test_student_report(_test, _stu);
    _principal_read_drill := true;
  EXCEPTION WHEN insufficient_privilege THEN
    _principal_read_drill := false;
  END;
  IF _principal_read_drill THEN
    RAISE EXCEPTION 'ROLLED BACK: the principal read a named child''s per-question detail (rule 13)';
  END IF;

  -- ── As the teacher: the positive control for BOTH claims above ─────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _teacher, 'role','authenticated')::text, true);
  _report := public.rpc_test_class_report(_test);
  IF (_report ->> 'submitted_count')::int <> 1
     OR _report -> 'weakest_topics' IS NULL
     OR _report -> 'students' IS NULL THEN
    RAISE EXCEPTION 'ROLLED BACK: the teacher''s report lost a key in the recomposition: %', _report;
  END IF;
  IF (_report -> 'students') <> (public.rpc_test_class_marks(_test) -> 'students') THEN
    RAISE EXCEPTION 'ROLLED BACK: the report''s student list no longer equals the marks list — two homes again';
  END IF;
  IF jsonb_array_length(public.rpc_test_student_report(_test, _stu) -> 'wrong_answers') <> 0 THEN
    RAISE EXCEPTION 'ROLLED BACK: an all-correct paper reported a wrong answer';
  END IF;

  PERFORM set_config('request.jwt.claims', '', true);

  DELETE FROM public.student_mistakes WHERE source_id = _test;
  DELETE FROM public.test_marks WHERE test_id = _test;
  DELETE FROM public.test_answers WHERE attempt_id = _att;
  DELETE FROM public.test_attempts WHERE test_id = _test;
  DELETE FROM public.test_questions WHERE test_id = _test;
  DELETE FROM public.tests WHERE id = _test;

  RAISE NOTICE 'verify OK: principal reads the marks, is refused the report and the drill-down; the teacher reads all three and the lists agree';
END
$verify$;
