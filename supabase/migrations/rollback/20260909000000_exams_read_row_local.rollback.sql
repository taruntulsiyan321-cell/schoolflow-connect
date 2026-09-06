-- Rollback for 20260909000000_exams_read_row_local.sql
--
-- Restores `exams_read` to the self-referential form it had before, and drops
-- the row-local predicate the fixed policy uses.
--
-- WHAT ROLLING BACK COSTS YOU. The pre-fix policy resolves through
-- `my_visible_exam_ids()`, which selects from `public.exams`. A STABLE function
-- cannot see the row its own statement is inserting, so restoring this
-- REINSTATES the defect: every `INSERT ... RETURNING` on exams -- which is what
-- PostgREST does for `.insert(...).select()`, and what
-- `examRepository.createClassExam` calls -- is refused
--
--     42501  new row violates row-level security policy for table "exams"
--
-- and no teacher can create an exam through the application again. Roll back
-- only to restore the previous state deliberately, not to "fix" something.
--
-- The DROP is ordered after the policy is recreated: dropping the function
-- first would fail while the fixed policy still depends on it.

BEGIN;

DROP POLICY IF EXISTS exams_read ON public.exams;
CREATE POLICY exams_read ON public.exams
FOR SELECT
USING (
  (school_id IN (SELECT public.my_accessible_school_ids()))
  AND (
    (id IN (SELECT public.my_visible_exam_ids()))
    OR ((SELECT public.is_super_admin()) AND (SELECT public.super_admin_has_any_access()))
  )
);

DROP FUNCTION IF EXISTS public.can_read_exam_row(uuid, uuid);

COMMENT ON FUNCTION public.my_visible_exam_ids() IS
  'Set of exam ids the caller may read.';

DO $verify$
DECLARE _pol text;
BEGIN
  SELECT pg_get_expr(p.polqual, p.polrelid) INTO _pol
    FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = 'exams' AND p.polname = 'exams_read';
  IF _pol IS NULL OR _pol !~ 'my_visible_exam_ids' THEN
    RAISE EXCEPTION 'ABORT: rollback did not restore the original exams_read';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname='public' AND p.proname='can_read_exam_row') THEN
    RAISE EXCEPTION 'ABORT: can_read_exam_row still exists after rollback';
  END IF;
  RAISE NOTICE 'exams_read restored to the self-referential form (defect reinstated, as intended).';
END $verify$;

COMMIT;
