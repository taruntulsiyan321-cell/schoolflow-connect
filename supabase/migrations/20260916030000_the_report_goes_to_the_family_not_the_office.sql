-- ═══════════════════════════════════════════════════════════════════════════
-- The report goes to the family, not the office (§10.25 — USER RULING)
--
-- The report's role set was contested and is now ruled. Asked directly, with
-- the spec's wording and the build instruction's wording side by side, the
-- answer was:
--
--     "Admin and Principal sees nothing. Teacher get a test report. Student
--      get their own reports plus leaderboard. Parents get their own child
--      reports."
--
-- That is neither of the two options on the table. It keeps the build
-- instruction's principal exclusion, ADDS the admin to it — who was admitted
-- by `20260916000000` and by nothing anyone had ruled — and grants the parent
-- the clause `docs/locked-decisions.md` §10.25 always gave them.
--
-- ── 1. THE CLASS REPORT IS THE TEACHING STAFF'S, AND NOBODY ELSE'S ───────
--
-- `can_read_test_report` was
--
--     has_role(uid,'admin') OR t.created_by = uid OR teacher_teaches_class(...)
--
-- Both of the first two go. The admin branch because the ruling names the
-- admin. `created_by` because it is the same door with a different key: an
-- admin who authored a test would still have read its report, and a rule that
-- says "the office sees nothing" with an authorship exception is not the rule
-- that was given. A teacher who created a test for a section they teach is
-- admitted by `teacher_teaches_class` anyway — measured, claim 2 of probe38
-- passes through that branch, not through authorship.
--
-- §10.20 gives the super admin "unrestricted access to academic data, for
-- support". They are refused here too: `teacher_teaches_class` is false for
-- them however many school grants they hold. That is fail-closed to the
-- ruling, and it is one `OR` away from being reopened if support needs it.
--
-- ── 2. THE PARENT, FOR THEIR OWN CHILD'S PART ONLY ──────────────────────
--
-- The parent reaches `rpc_test_student_report` for a child of theirs, and
-- NOTHING else — not the class aggregate, which would hand one family another
-- family's marks. Measured before this was written, in a rolled-back trial of
-- this exact body: parent of the sitter true; parent of the other child false
-- in both directions; the class report refused with "Not your class's test
-- report".
--
-- "A child of theirs" is `my_children_student_ids()`, which already resolves
-- BOTH guardian linkages (`students.parent_user_id` and `parent_students`) and
-- is already the home for this question. It is SECURITY DEFINER and
-- `authenticated` has no EXECUTE on it — that is fine and was verified, not
-- assumed: called from inside this fence it runs as the owner while still
-- reading the CALLER's session, so it returns the caller's children and an
-- empty array for anyone not acting as a parent.
--
-- ── 3. A REPORT IS STILL SOMETHING YOU SAT ───────────────────────────────
--
-- `20260916020000` closed an answer-key disclosure by requiring the student to
-- have a submitted attempt. The parent branch carries the SAME condition — a
-- parent must not be able to read the paper before their child sits it either
-- — so the condition is now `_test_was_sat_by()`, written once and shared,
-- rather than the same three-table join copied into a second branch (G9).
--
-- ── 4. THE STUDENT'S LEADERBOARD ─────────────────────────────────────────
--
-- "plus leaderboard". `rank` and `class_size` are added to the student report:
-- how many submitted attempts scored above this one, and how many sat it.
--
-- NO OTHER STUDENT'S NAME OR MARK IS RETURNED, deliberately. A rank tells a
-- student where they stand without telling them anything about a named child,
-- and probe38 claim 6 — a student may never see the class aggregate — is still
-- true. If a named leaderboard is wanted it is a widening of THIS field, and it
-- is a disclosure decision, not a UI one.
--
-- Both are NULL when there is no submitted attempt. Without that guard
-- `count(*) WHERE score > NULL` is 0 and every non-sitter ranks first.
--
-- Rollback: supabase/migrations/rollback/
--           20260916030000_the_report_goes_to_the_family_not_the_office.rollback.sql
-- Assertion: verification/caller-privileges/probe38.sql (claims 15-19)
-- ═══════════════════════════════════════════════════════════════════════════

-- ── The shared precondition ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._test_was_sat_by(_test_id uuid, _student_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
      FROM public.students s
      JOIN public.tests t
        ON t.id = _test_id
       AND t.deleted_at IS NULL
       AND t.school_id = s.school_id
      JOIN public.test_attempts a
        ON a.test_id = t.id
       AND a.status = 'submitted'
       AND (a.student_id = s.id OR a.user_id = s.user_id)
     WHERE s.id = _student_id
  )
$function$;

COMMENT ON FUNCTION public._test_was_sat_by(uuid, uuid) IS
  'Did this student submit an attempt at this test, in their own school. The '
  'precondition for any per-student report: it is what stops the answer key '
  'being readable before the paper is sat, and it is shared by the student and '
  'parent branches of can_read_test_student_report rather than copied.';

REVOKE ALL ON FUNCTION public._test_was_sat_by(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._test_was_sat_by(uuid, uuid) TO authenticated;

-- ── 1. The class report: the teachers of that section ─────────────────────
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
       -- The whole rule. No admin branch, no authorship branch: the ruling is
       -- "Admin and Principal sees nothing", and an authorship exception is
       -- the admin branch wearing a different name.
       AND public.teacher_teaches_class((SELECT auth.uid()), ss.section_id)
  )
$function$;

COMMENT ON FUNCTION public.can_read_test_report(uuid) IS
  'Sole authority for who may read a test CLASS report: the teachers who teach '
  'that section. Admin, principal, parent and student are all refused — user '
  'ruling, 2026-09-09, recorded in 20260916030000. The parent and the student '
  'reach their own per-student report through can_read_test_student_report.';

-- ── 2/3. The per-student report: the student, or a parent of that student ─
CREATE OR REPLACE FUNCTION public.can_read_test_student_report(_test_id uuid, _student_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT public.can_read_test_report(_test_id)
      OR (
           public._test_was_sat_by(_test_id, _student_id)
           AND (
             EXISTS (SELECT 1 FROM public.students s
                      WHERE s.id = _student_id
                        AND s.user_id = (SELECT auth.uid()))
             -- Empty array for anyone not acting as a parent, so this branch
             -- cannot admit a non-parent even by accident.
             OR _student_id = ANY (public.my_children_student_ids())
           )
         )
$function$;

COMMENT ON FUNCTION public.can_read_test_student_report(uuid, uuid) IS
  'The teachers of the section, OR the student the report is about, OR a parent '
  'of that student — and for the last two only on a test that student actually '
  'submitted. Parents reach this and never rpc_test_class_report: one family '
  'must not read another family''s marks.';

-- ── 4. The student report, with the leaderboard position ──────────────────
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
    'submitted', (a.id IS NOT NULL),
    -- The leaderboard, as a POSITION and nothing else. Names and marks of the
    -- other children are deliberately absent — see the header.
    'rank', CASE WHEN a.id IS NULL THEN NULL ELSE (
       SELECT count(*) + 1 FROM public.test_attempts a2
        WHERE a2.test_id = _test_id AND a2.status = 'submitted'
          AND a2.score > a.score) END,
    'class_size', CASE WHEN a.id IS NULL THEN NULL ELSE (
       SELECT count(*) FROM public.test_attempts a2
        WHERE a2.test_id = _test_id AND a2.status = 'submitted') END,
    'wrong_answers', CASE WHEN a.id IS NULL THEN '[]'::jsonb ELSE COALESCE((
       SELECT jsonb_agg(jsonb_build_object(
                'question_id', q.id,
                'order_index', q.order_index,
                'question', q.question,
                'topic', COALESCE(NULLIF(btrim(q.concept), ''), NULLIF(btrim(q.chapter), ''), 'Unlabelled'),
                'marks', q.marks,
                'question_format', q.question_format,
                'options', q.options,
                'their_answer', ans.response,
                'correct_answer', q.correct,
                'explanation', q.explanation,
                'answered', (ans.id IS NOT NULL)
              ) ORDER BY q.order_index)
         FROM public.test_questions q
         LEFT JOIN public.test_answers ans
                ON ans.question_id = q.id AND ans.attempt_id = a.id
        WHERE q.test_id = _test_id
          AND COALESCE(ans.is_correct, false) = false), '[]'::jsonb) END
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

REVOKE ALL ON FUNCTION public.can_read_test_report(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_read_test_student_report(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rpc_test_student_report(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_read_test_report(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_read_test_student_report(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_test_student_report(uuid, uuid) TO authenticated;

-- ── Proof, before this commits ────────────────────────────────────────────
--
-- Runs as `postgres`, so it cannot prove an RLS refusal — probe38 does that.
-- What it CAN do is set the claim these SECURITY DEFINER functions read through
-- auth.uid(), and check the ruling's three edges against live rows. It writes
-- nothing.
DO $verify$
DECLARE
  sch_a   uuid := '00000000-0000-4000-8000-000000000001';
  cls10   uuid := 'd2000001-0001-4000-8000-000000000001';
  admin_u uuid;
  teacher uuid;
  stu     uuid; stu_uid uuid; par uuid;
  sat_test uuid;
BEGIN
  SELECT id INTO admin_u  FROM auth.users WHERE email = 'admin@wisdomcampus.com';
  SELECT id INTO teacher  FROM auth.users WHERE email = 'priya.sharma@wisdomcampus.com';

  SELECT s.id, s.user_id, s.parent_user_id INTO stu, stu_uid, par
    FROM public.students s
   WHERE s.school_id = sch_a AND s.class_id = cls10
     AND s.user_id IS NOT NULL AND s.parent_user_id IS NOT NULL
   ORDER BY s.id LIMIT 1;

  IF admin_u IS NULL OR teacher IS NULL OR stu IS NULL THEN
    RAISE EXCEPTION
      'ROLLED BACK: fixtures missing (admin=%, teacher=%, student-with-parent=%) '
      '— a check that cannot run is not a check that passed', admin_u, teacher, stu;
  END IF;

  -- A test this student actually sat, if one exists. The 72 seeded tests are
  -- all in the other school, so this may legitimately be NULL; the parent
  -- claims then belong to probe38, which builds its own fixture.
  SELECT a.test_id INTO sat_test
    FROM public.test_attempts a
    JOIN public.tests t ON t.id = a.test_id AND t.deleted_at IS NULL
   WHERE a.status = 'submitted' AND (a.student_id = stu OR a.user_id = stu_uid)
   ORDER BY a.id LIMIT 1;

  -- THE ADMIN, on any test in their own school.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', admin_u, 'role','authenticated')::text, true);
  IF EXISTS (
    SELECT 1 FROM public.tests t
     WHERE t.school_id = sch_a AND t.deleted_at IS NULL
       AND public.can_read_test_report(t.id)
    LIMIT 1
  ) THEN
    PERFORM set_config('request.jwt.claims', '', true);
    RAISE EXCEPTION 'ROLLED BACK: the admin still reads a class report — the ruling says the office sees nothing';
  END IF;
  PERFORM set_config('request.jwt.claims', '', true);

  IF sat_test IS NOT NULL THEN
    -- THE PARENT — the widening this migration exists for.
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', par, 'role','authenticated')::text, true);
    IF NOT public.can_read_test_student_report(sat_test, stu) THEN
      PERFORM set_config('request.jwt.claims', '', true);
      RAISE EXCEPTION 'ROLLED BACK: a parent cannot read their own child''s report';
    END IF;
    -- ...and the class aggregate stays shut to them.
    IF public.can_read_test_report(sat_test) THEN
      PERFORM set_config('request.jwt.claims', '', true);
      RAISE EXCEPTION 'ROLLED BACK: a parent reached the CLASS report — that is another family''s marks';
    END IF;
    PERFORM set_config('request.jwt.claims', '', true);
  ELSE
    RAISE NOTICE 'no submitted attempt for this student — the parent claims are probe38''s, which builds its own fixture';
  END IF;

  -- The leaderboard field must be in the payload, or the ruling's third clause
  -- is unimplemented while everything else passes.
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'rpc_test_student_report'
       AND pg_get_functiondef(p.oid) LIKE '%''class_size''%'
       AND pg_get_functiondef(p.oid) LIKE '%''rank''%'
  ) THEN
    RAISE EXCEPTION 'ROLLED BACK: the student report carries no leaderboard position';
  END IF;

  -- And the admin branch must be GONE from the text, not merely inert.
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'can_read_test_report'
       AND pg_get_functiondef(p.oid) LIKE '%has_role%'
  ) THEN
    RAISE EXCEPTION 'ROLLED BACK: can_read_test_report still names a role branch';
  END IF;

  RAISE NOTICE 'ruling applied: office refused, teacher keeps the class report, parent reaches their own child, student gets a rank.';
END $verify$;
