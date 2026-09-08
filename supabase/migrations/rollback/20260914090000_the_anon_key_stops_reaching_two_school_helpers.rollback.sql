-- Rollback for 20260914090000_the_anon_key_stops_reaching_two_school_helpers.sql
--
-- Puts back BOTH things the forward migration removed: the anon grant on
-- storage_object_owner_school_id, and the my_visible_exam_ids() function.
--
-- The function body is reproduced from `20260827160000_chunk66_...` (its second
-- definition, line 727) rather than referred to, because a rollback that cannot
-- run standalone is not a rollback. It is restored with its ORIGINAL PUBLIC
-- grant so the state after this file is the state before the forward migration,
-- anon reachability included -- which is the point of a rollback and also why
-- rolling this back re-opens a §10.19 hole.
--
-- Do this only to unblock something else, and re-apply.

BEGIN;

-- The body below is the LIVE definition, captured with pg_get_functiondef
-- BEFORE the forward migration dropped it. A first draft of this file
-- reconstructed it from the migration history and got it wrong in four places
-- (it used my_accessible_school_ids, teacher_teaches_class, my_class_id and a
-- super_admin branch, none of which the live function had). A rollback that
-- restores a DIFFERENT predicate under the same name is worse than none.

CREATE OR REPLACE FUNCTION public.my_visible_exam_ids()
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT e.id
    FROM public.exams e
   WHERE e.school_id = (SELECT public.active_membership_school_id())
     AND CASE (SELECT public.active_membership_role())
           WHEN 'admin'     THEN true
           WHEN 'principal' THEN true
           WHEN 'teacher'   THEN e.class_id IN (SELECT public.my_teacher_class_ids())
           WHEN 'student'   THEN e.class_id = (SELECT public.student_class_id(auth.uid()))
           WHEN 'parent'    THEN e.class_id IN (SELECT unnest(public.my_children_class_ids()))
           ELSE false
         END
$function$;

-- The original ACL was `=X/postgres` -- a PUBLIC grant, which is how anon
-- reached it. Restored as it was.
GRANT EXECUTE ON FUNCTION public.my_visible_exam_ids() TO PUBLIC;

COMMENT ON FUNCTION public.my_visible_exam_ids() IS
  'Set of exam ids the caller may read. NOT usable in a policy ON public.exams '
  'itself: it selects from that table, so during INSERT ... RETURNING it '
  'cannot see the row being inserted and the insert is refused 42501. '
  'exams_read uses can_read_exam_row instead. Unreferenced as of 2026-09-08.';

GRANT EXECUTE ON FUNCTION public.storage_object_owner_school_id(text) TO anon;

COMMENT ON FUNCTION public.storage_object_owner_school_id(text) IS
  'The school of whoever uploaded a storage object, read from segment 1 of the '
  'object name. SECURITY DEFINER because the `academic files read` policy runs '
  'as the CALLER. Reachable by anon again -- see 20260914090000.';

DO $verify$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'public' AND p.proname = 'my_visible_exam_ids') THEN
    RAISE EXCEPTION 'ABORT: my_visible_exam_ids() was not restored';
  END IF;

  IF NOT has_function_privilege('anon', 'public.storage_object_owner_school_id(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ABORT: the anon grant was not restored';
  END IF;

  -- Positive control: the rollback must not have cost the legitimate roles
  -- their access on the way to restoring anon's.
  IF NOT has_function_privilege('authenticated', 'public.storage_object_owner_school_id(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ABORT: authenticated lost execute during the rollback';
  END IF;

  RAISE NOTICE 'both helpers are reachable by anon again -- CHUNK95_ANON_SURFACE_VERIFY item 1 will fail, as it did before.';
END $verify$;

COMMIT;
