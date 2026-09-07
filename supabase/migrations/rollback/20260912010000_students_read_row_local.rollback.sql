-- Rollback for 20260912010000_students_read_row_local.sql
--
-- Restores students_read to the self-referential `id IN (SELECT
-- my_visible_student_ids())` form and drops the row-local predicate.
--
-- WHAT ROLLING BACK COSTS YOU, in two ways:
--
--  * CORRECTNESS. my_visible_student_ids() selects FROM public.students, and a
--    STABLE function cannot see the row its own statement is inserting, so
--    `INSERT ... RETURNING` on students is refused 42501 for any role not
--    rescued by the separate `students admin and principal all` policy — i.e.
--    every role except admin and principal.
--  * COST. The policy calls a function that scans students, once per student
--    row: O(n^2) on the roster for every teacher, student and parent read.
--
-- Roll back only to restore the previous definition deliberately.
BEGIN;

DROP POLICY IF EXISTS students_read ON public.students;
CREATE POLICY students_read ON public.students
FOR SELECT
USING (id IN ( SELECT public.my_visible_student_ids() AS my_visible_student_ids));

DROP FUNCTION IF EXISTS public.can_read_student_row(uuid, uuid, uuid, uuid, uuid);

COMMENT ON FUNCTION public.my_visible_student_ids() IS
  'Set of student ids the caller may read.';

COMMIT;

DO $verify$
DECLARE _pol text;
BEGIN
  SELECT pg_get_expr(p.polqual, p.polrelid) INTO _pol
    FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
   WHERE c.relname = 'students' AND p.polname = 'students_read';
  IF _pol IS NULL OR _pol !~ 'my_visible_student_ids' THEN
    RAISE EXCEPTION 'ABORT: rollback did not restore the self-referential students_read';
  END IF;
  RAISE NOTICE 'students_read restored to the self-referential form (42501 and O(n^2) are back, as intended).';
END $verify$;
