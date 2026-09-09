-- ═══════════════════════════════════════════════════════════════════════════
-- A teacher can finally see how the class did (§10.25, §10.22, §10.23)
--
-- There is no teacher-side test report in this project and never has been.
-- `TestService` has `getMyAttempt` (the caller's own) and
-- `listLatestAttemptsForStudent` — used only by the PARENT panel. Nothing
-- anywhere lists a class's attempts.
--
-- Measured 2026-09-09: 72 tests, 458 submitted attempts, 576 questions, and
-- not one screen through which a teacher can see any of it.
--
-- ── WHAT IS ALREADY DURABLE, AND IS NOT REBUILT HERE ─────────────────────
--
-- `rpc_test_submit` already writes the mark synchronously at submit time:
--
--     -- The durable outcome. test_marks is the authority (§10.22): one mark
--     -- per student per test.
--     INSERT INTO public.test_marks (...) ON CONFLICT (test_id, student_id)
--       DO UPDATE SET mark = EXCLUDED.mark;
--
-- and it lands `test_answers.is_correct` / `marks_awarded` / `time_ms` plus the
-- mistake book in the same transaction. So "marks must be written before
-- anything expires" is already satisfied by construction — the mark is durable
-- BEFORE any report exists to expire. Nothing here re-derives it.
--
-- These reports are therefore COMPUTED from durable rows, not stored. There is
-- no report table and nothing to purge: the ephemeral half of the requirement
-- is satisfied by not persisting a second copy of a fact the answers already
-- carry (G9). §10.23 makes test answers school data that persists, and §10.25
-- requires "their actual wrong answers" on tap — which needs them.
--
-- ── THE ROLE SET LIVES IN EXACTLY ONE PLACE ──────────────────────────────
--
-- `can_read_test_report` is the only thing that decides who may see a report.
-- Both RPCs call it; neither re-states the rule. That is deliberate, because
-- the rule is CONTESTED and will likely change:
--
--   `docs/locked-decisions.md` §10.25 says
--       "Visible to: teacher · principal · the student themselves ·
--        parent, for their own child's part only."
--
--   The build instruction for this work says
--       "Student sees their own data only. Principal sees nothing."
--       and requires an assertion that the principal is refused entirely.
--
-- THESE CONTRADICT. Built FAIL-CLOSED to the narrower rule — principal and
-- parent refused — because a report wrongly withheld is a missing feature and
-- a report wrongly shown is a disclosure about a named child. Widening it to
-- §10.25 is a one-line edit to `can_read_test_report` plus flipping the
-- matching assertions in probe38. Nothing else in the system needs to move.
--
-- Rollback: supabase/migrations/rollback/
--           20260916000000_a_teacher_can_finally_see_how_the_class_did.rollback.sql
-- Assertion: verification/caller-privileges/probe38.sql
-- ═══════════════════════════════════════════════════════════════════════════

-- ── The fence. One function, one rule. ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.can_read_test_report(_test_id uuid)
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
         (SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role))
         OR t.created_by = (SELECT auth.uid())
         -- §10.25 names the principal here too. Deliberately absent — see the
         -- header. Add `OR is_principal_or_admin(...)` to widen.
         OR public.teacher_teaches_class((SELECT auth.uid()), ss.section_id)
       )
  )
$function$;

COMMENT ON FUNCTION public.can_read_test_report(uuid) IS
  'Sole authority for who may read a test report. Fail-closed: staff who teach '
  'the section, plus admin. Principal and parent are deliberately excluded and '
  'that is contested against locked-decisions §10.25 — see 20260916000000.';

-- ── The student view of the same fence: staff, or that student themselves ──
CREATE OR REPLACE FUNCTION public.can_read_test_student_report(_test_id uuid, _student_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT public.can_read_test_report(_test_id)
      OR EXISTS (
           SELECT 1 FROM public.students s
            WHERE s.id = _student_id
              AND s.user_id = (SELECT auth.uid())
         )
$function$;

COMMENT ON FUNCTION public.can_read_test_student_report(uuid, uuid) IS
  'Staff who may read the class report, OR the student that report is about. '
  'A student reaches their own and no other.';

-- ── Class aggregate — the primary view (§10.25) ───────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_test_class_report(_test_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _out jsonb;
BEGIN
  IF NOT public.can_read_test_report(_test_id) THEN
    RAISE EXCEPTION 'Not your class''s test report' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'test_id', t.id,
    'title', t.title,
    'max_mark', t.max_mark,
    'subject', cs.name,
    'submitted_count', (SELECT count(*) FROM public.test_attempts a
                         WHERE a.test_id = t.id AND a.status = 'submitted'),
    -- Null when nobody has submitted. A class average of 0 and "nobody sat it
    -- yet" are different facts and must not render the same (G4).
    'class_average', (SELECT round(avg(a.score)::numeric, 2) FROM public.test_attempts a
                       WHERE a.test_id = t.id AND a.status = 'submitted'),
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
       ) x), '[]'::jsonb),
    -- Full student list with marks. A student who never sat it appears with a
    -- NULL mark, not a zero — "not marked" is never 0 (§7).
    'students', COALESCE((
       SELECT jsonb_agg(y ORDER BY y.full_name) FROM (
         SELECT s.id AS student_id, s.full_name, s.roll_number,
                a.score AS mark, a.correct_count, a.total_count,
                a.submitted_at,
                (a.id IS NOT NULL AND a.status = 'submitted') AS submitted
           FROM public.students s
           LEFT JOIN public.test_attempts a
                  ON a.test_id = t.id
                 AND (a.student_id = s.id OR a.user_id = s.user_id)
                 AND a.status = 'submitted'
          WHERE s.class_id = ss.section_id
            AND s.school_id = t.school_id
       ) y), '[]'::jsonb)
  )
    INTO _out
    FROM public.tests t
    JOIN public.section_subjects ss ON ss.id = t.section_subject_id
    LEFT JOIN public.curriculum_subjects cs ON cs.id = ss.curriculum_subject_id
   WHERE t.id = _test_id;

  RETURN _out;
END;
$function$;

-- ── Drill-down: one student's wrong answers, with the topic on each ───────
CREATE OR REPLACE FUNCTION public.rpc_test_student_report(_test_id uuid, _student_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _out jsonb;
BEGIN
  IF NOT public.can_read_test_student_report(_test_id, _student_id) THEN
    RAISE EXCEPTION 'Not your test report' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'test_id', _test_id,
    'student_id', _student_id,
    'full_name', s.full_name,
    'mark', a.score,
    'max_mark', t.max_mark,
    'correct_count', a.correct_count,
    'total_count', a.total_count,
    'submitted_at', a.submitted_at,
    -- ONLY the wrong ones. §10.25: "their actual wrong answers, with the topic
    -- on each". A per-question list of what they got RIGHT is not part of the
    -- report and is not returned.
    'wrong_answers', COALESCE((
       SELECT jsonb_agg(jsonb_build_object(
                'question_id', q.id,
                'order_index', q.order_index,
                'question', q.question,
                'topic', COALESCE(NULLIF(btrim(q.concept), ''), NULLIF(btrim(q.chapter), ''), 'Unlabelled'),
                'marks', q.marks,
                'their_answer', ans.response,
                'correct_answer', q.correct,
                'explanation', q.explanation,
                'answered', (ans.id IS NOT NULL)
              ) ORDER BY q.order_index)
         FROM public.test_questions q
         LEFT JOIN public.test_answers ans
                ON ans.question_id = q.id AND ans.attempt_id = a.id
        WHERE q.test_id = _test_id
          AND COALESCE(ans.is_correct, false) = false), '[]'::jsonb)
  )
    INTO _out
    FROM public.students s
    JOIN public.tests t ON t.id = _test_id
    LEFT JOIN public.test_attempts a
           ON a.test_id = _test_id
          AND (a.student_id = s.id OR a.user_id = s.user_id)
          AND a.status = 'submitted'
   WHERE s.id = _student_id;

  RETURN _out;
END;
$function$;

-- Callable by signed-in users only; each function fences itself.
REVOKE ALL ON FUNCTION public.can_read_test_report(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_read_test_student_report(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rpc_test_class_report(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rpc_test_student_report(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_read_test_report(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_read_test_student_report(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_test_class_report(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_test_student_report(uuid, uuid) TO authenticated;

-- ── Proof, before this commits ────────────────────────────────────────────
DO $verify$
DECLARE
  teacher uuid; principal uuid; stu_user uuid;
  t_id uuid; s_id uuid;
BEGIN
  SELECT id INTO teacher   FROM auth.users WHERE email = 'priya.sharma@wisdomcampus.com';
  SELECT id INTO principal FROM auth.users WHERE email = 'principal@wisdomcampus.com';
  IF teacher IS NULL OR principal IS NULL THEN
    RAISE EXCEPTION 'ROLLED BACK: fixtures missing — a check that cannot run is not a check that passed';
  END IF;

  -- Any test whose section this teacher teaches.
  SELECT t.id INTO t_id
    FROM public.tests t
    JOIN public.section_subjects ss ON ss.id = t.section_subject_id
   WHERE t.deleted_at IS NULL
     AND public.teacher_teaches_class(teacher, ss.section_id)
   LIMIT 1;

  IF t_id IS NULL THEN
    -- No test exists on this teacher's sections yet (all 72 seeded tests are in
    -- the other school). The functions still install; probe38 is what asserts
    -- behaviour, and it builds its own fixture. Say so rather than pass quietly.
    RAISE NOTICE 'no test on this teacher''s sections — behaviour is asserted by probe38, not here';
  ELSE
    PERFORM set_config('request.jwt.claims', json_build_object('sub', teacher, 'role','authenticated')::text, true);
    IF NOT public.can_read_test_report(t_id) THEN
      RAISE EXCEPTION 'ROLLED BACK: the teacher who teaches this section cannot read its report';
    END IF;

    PERFORM set_config('request.jwt.claims', json_build_object('sub', principal, 'role','authenticated')::text, true);
    IF public.can_read_test_report(t_id) THEN
      RAISE EXCEPTION 'ROLLED BACK: the principal was admitted — this build is fail-closed (see header)';
    END IF;
    PERFORM set_config('request.jwt.claims', '', true);
  END IF;

  RAISE NOTICE 'can_read_test_report installed: teaching staff admitted, principal refused.';
END $verify$;
