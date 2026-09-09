-- ═══════════════════════════════════════════════════════════════════════════
-- A test cannot be created by looking itself up (§7, §10.5, §8)
--
-- `tests_insert` was:
--
--     INSERT WITH CHECK (can_manage_test(id))
--
-- and `can_manage_test` is
--
--     SELECT EXISTS (SELECT 1 FROM public.tests t WHERE t.id = _test_id AND …)
--
-- It looks the new test up IN `tests`, by the id the row is being given. On an
-- INSERT that row is not visible to the function's snapshot — `can_manage_test`
-- is STABLE, so it reads the statement snapshot, which predates the row. The
-- predicate is therefore false for every insert, and `tests_insert` refuses
-- every insert this project has ever attempted.
--
-- ── MEASURED, AS THE CALLER ──────────────────────────────────────────────
--
-- probe37, as the demo teacher, inserting only columns `tests` actually has:
--
--     ERROR: new row violates row-level security policy for table "tests"
--
-- And in the data: 72 tests exist, 0 published, and `tests.status` holds
-- exactly one value across the whole database — 'submitted'. Every one of the
-- 72 arrived from seed SQL. Not one test in this project was created through
-- the app.
--
-- Same family as `students_read` (KNOWN_ISSUES 21) and `exams_read` before it:
-- a policy whose predicate re-queries the table it guards. There it broke
-- `INSERT … RETURNING`; here it breaks the INSERT itself.
--
-- ── WHY A NEW FUNCTION AND NOT AN EDIT ───────────────────────────────────
--
-- `can_manage_test(id)` is also the predicate for `tests_update` and
-- `tests_delete`, where the row DOES exist and the lookup is correct. Editing
-- it to suit INSERT would break the two cases it currently gets right. So the
-- INSERT gets its own predicate over the NEW ROW'S VALUES, which is the only
-- thing an INSERT check can honestly test.
--
-- ── WHAT THE NEW PREDICATE ENFORCES ──────────────────────────────────────
--
--   the section_subject is real, and belongs to the SAME SCHOOL as the test
--        — a test may not anchor on another school's section (§10.19)
--   created_by = auth.uid()
--        — §8: "Homework and tests are credited to whoever created them".
--          A test may not be attributed to someone else.
--   admin, OR a teacher who teaches that section
--        — §10.5: "Subject teachers create tests for the subjects they teach."
--
-- PRINCIPAL IS DELIBERATELY ABSENT. §10: the principal "cannot create or edit
-- any record except announcements". `can_manage_test` does not admit them
-- either, so this keeps INSERT and UPDATE agreeing on that.
--
-- Class-level, not subject-level, matching what the service has enforced since
-- the subject soft-check was removed for blocking real teachers
-- (`assertTeacherCanWriteTest`). Narrowing to subject is a separate ruling.
--
-- Rollback: supabase/migrations/rollback/
--           20260915000000_a_test_cannot_be_created_by_looking_itself_up.rollback.sql
-- Assertion: verification/caller-privileges/probe37.sql — three refusals and
--            two positive controls, run as the teacher themselves.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.can_create_test(
  _school_id uuid,
  _section_subject_id uuid,
  _created_by uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
      FROM public.section_subjects ss
     WHERE ss.id = _section_subject_id
       -- the anchor may not point at another school's section
       AND ss.school_id = _school_id
       AND public.same_school(_school_id)
       -- §8: credited to whoever created it, so it cannot be filed under anyone else
       AND _created_by = (SELECT auth.uid())
       AND (
         (SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role))
         -- §10.5: subject teachers create tests for what they teach
         OR public.teacher_teaches_class((SELECT auth.uid()), ss.section_id)
       )
  )
$function$;

COMMENT ON FUNCTION public.can_create_test(uuid, uuid, uuid) IS
  'INSERT-side companion to can_manage_test. Tests the NEW row''s values, '
  'because an INSERT check cannot look the row up: the row does not exist yet. '
  'See 20260915000000.';

REVOKE ALL ON FUNCTION public.can_create_test(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_create_test(uuid, uuid, uuid) TO authenticated;

DROP POLICY IF EXISTS tests_insert ON public.tests;
CREATE POLICY tests_insert ON public.tests
  FOR INSERT TO authenticated
  WITH CHECK (public.can_create_test(school_id, section_subject_id, created_by));

-- ── Proof, in the same transaction that made the change ───────────────────
-- A migration that cannot show its own effect is a claim, not a change. This
-- refuses to commit unless the new predicate admits a real teacher writing a
-- real row AND still refuses the two things it exists to refuse.
DO $verify$
DECLARE
  teacher uuid;
  outsider uuid;
  sch_a  uuid := '00000000-0000-4000-8000-000000000001';
  ss     uuid;
  ok_self boolean;
  ok_other_creator boolean;
  ok_outsider boolean;
BEGIN
  SELECT id INTO teacher  FROM auth.users WHERE email = 'priya.sharma@wisdomcampus.com';
  SELECT id INTO outsider FROM auth.users WHERE email = 'principal@wisdomcampus.com';
  SELECT s.id INTO ss
    FROM public.section_subjects s
   WHERE s.section_id = 'd2000001-0001-4000-8000-000000000001' AND s.school_id = sch_a
   LIMIT 1;

  IF teacher IS NULL OR outsider IS NULL OR ss IS NULL THEN
    RAISE EXCEPTION
      'ROLLED BACK: fixtures missing (teacher=%, principal=%, section_subject=%) — '
      'a check that cannot run is not a check that passed', teacher, outsider, ss;
  END IF;

  -- As the teacher: their own row must be admitted (POSITIVE CONTROL).
  PERFORM set_config('request.jwt.claims', json_build_object('sub', teacher, 'role','authenticated')::text, true);
  ok_self := public.can_create_test(sch_a, ss, teacher);

  -- Still as the teacher: filing the test under someone else must be refused.
  ok_other_creator := public.can_create_test(sch_a, ss, outsider);

  -- As the principal: §10 says they create nothing.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', outsider, 'role','authenticated')::text, true);
  ok_outsider := public.can_create_test(sch_a, ss, outsider);

  PERFORM set_config('request.jwt.claims', '', true);

  IF NOT ok_self THEN
    RAISE EXCEPTION 'ROLLED BACK: the teacher who teaches this section is still refused their own test';
  END IF;
  IF ok_other_creator THEN
    RAISE EXCEPTION 'ROLLED BACK: a test could be filed under another user (§8)';
  END IF;
  IF ok_outsider THEN
    RAISE EXCEPTION 'ROLLED BACK: the principal was admitted to test creation (§10)';
  END IF;

  RAISE NOTICE 'can_create_test: teacher admitted, foreign creator refused, principal refused.';
END $verify$;
