-- Rollback for 20260916030000_the_report_goes_to_the_family_not_the_office
--
-- This restores the role set as it stood after `20260916020000`: the class
-- report readable by admin, by the test's author and by the teachers of the
-- section; the per-student report readable by those plus the student; no
-- parent; no leaderboard position.
--
-- WHAT ROLLING THIS BACK COSTS, and it is a product decision, not a technical
-- one: the office gets the class report back and the parent loses their own
-- child's. Both directions contradict the user's ruling of 2026-09-09, quoted
-- in full in the migration header. Do not run this to "undo a bug" — the
-- ruling is the thing being undone.
--
-- What it does NOT restore is the disclosure `20260916020000` closed. The
-- student branch keeps its "must have sat it" condition, written inline here
-- because `_test_was_sat_by` is dropped with this migration.

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
         OR public.teacher_teaches_class((SELECT auth.uid()), ss.section_id)
       )
  )
$function$;

CREATE OR REPLACE FUNCTION public.can_read_test_student_report(_test_id uuid, _student_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT public.can_read_test_report(_test_id)
      OR EXISTS (
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
              AND s.user_id = (SELECT auth.uid())
         )
$function$;

DROP FUNCTION IF EXISTS public._test_was_sat_by(uuid, uuid);

DO $verify$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'can_read_test_student_report'
       AND pg_get_functiondef(p.oid) LIKE '%my_children_student_ids%'
  ) THEN
    RAISE EXCEPTION 'ROLLED BACK: the parent branch is still present';
  END IF;

  -- The disclosure fix must survive this rollback. If it did not, rolling back
  -- a product ruling would silently reopen an answer-key leak.
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'can_read_test_student_report'
       AND pg_get_functiondef(p.oid) LIKE '%test_attempts%'
       AND pg_get_functiondef(p.oid) LIKE '%submitted%'
  ) THEN
    RAISE EXCEPTION 'ROLLED BACK: the student branch lost its submitted-attempt condition — that is the 20260916020000 disclosure reopened';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname='public' AND p.proname='_test_was_sat_by') THEN
    RAISE EXCEPTION 'ROLLED BACK: _test_was_sat_by still present';
  END IF;

  RAISE NOTICE 'role set restored to the 20260916020000 state; the disclosure fix is intact.';
END $verify$;
