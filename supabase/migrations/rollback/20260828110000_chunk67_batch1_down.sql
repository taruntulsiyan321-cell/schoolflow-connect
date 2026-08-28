-- =====================================================================
-- REVERSE OF Chunk 6.7 batch 1, all three measurements:
--   20260828110000_chunk67_batch1_academic_events.sql
--   20260828120000_chunk67_batch1b_academic_events_select.sql
--   20260828130000_chunk67_batch1c_initplan_hoist.sql
--
-- One reverse for three files because they are one logical change taken in
-- three passes — fence, then the SELECT policy the fence rewrite did not
-- fix, then hoisting the identity calls out of the per-row filter. There
-- is no state between them worth returning to.
--
-- WHAT THIS COSTS, measured on this database rather than estimated:
--
--   academic_events, 9,375 rows, as parent   BEFORE  75,027 ms
--                                            AFTER       13.3 ms
--
-- Against an 8 s statement timeout. Running this puts the table back to
-- roughly 75 seconds for a parent, student, teacher and principal — an
-- HTTP 500 on any screen that reads it, at the volume the demo database
-- holds today. It is not a slower read; it is a broken one.
--
-- WHAT IS DELIBERATELY NOT REVERSED
--
-- The GRANT EXECUTE on my_accessible_school_ids() to anon and authenticated
-- stays. It was added here, but Chunk 6.6 already routes marks, exams,
-- exam_subjects, tests, test_marks, report_cards, students and
-- student_academic_profiles through the same function. Revoking it would
-- not undo batch 1, it would break eight tables that have nothing to do
-- with it. A grant is not the thing this migration changed; the policies
-- are.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. The SELECT policy, back to the per-row form from
--    20260730020000_academic_engine_foundation.sql.
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS academic_events_admin_select ON public.academic_events;
CREATE POLICY academic_events_admin_select ON public.academic_events
  FOR SELECT TO authenticated
  USING (public.is_principal_or_admin(auth.uid()) AND public.same_school(school_id));

-- ---------------------------------------------------------------------
-- 2. The tenant fence, back to the per-row same_school() call.
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS academic_events_tenant_fence ON public.academic_events;
CREATE POLICY academic_events_tenant_fence ON public.academic_events
  AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING      (school_id IS NULL OR public.same_school(school_id))
  WITH CHECK (school_id IS NULL OR public.same_school(school_id));

-- The three no-client-write policies are untouched by batch 1 and stay as
-- they are; listing them here would risk recreating them wrongly.

DELETE FROM public.schema_migrations
 WHERE version IN (
   '20260828110000_chunk67_batch1_academic_events',
   '20260828120000_chunk67_batch1b_academic_events_select',
   '20260828130000_chunk67_batch1c_initplan_hoist'
 );

COMMIT;
