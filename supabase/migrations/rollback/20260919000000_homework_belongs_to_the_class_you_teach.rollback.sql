-- Rollback for 20260919000000.
--
-- Restores the authorship branch, WHICH REOPENS THE HOLE: `created_by` is set
-- by the client on every insert, so the OR makes `teacher_teaches_class`
-- decorative and any teacher can assign homework into any class in their
-- school. Measured by probe43 on 2026-09-11, claim 2.
--
-- Only run this if the narrowed rule is refusing a teacher who genuinely
-- teaches the class — in which case the fault is in `teacher_teaches_class` or
-- in `teacher_classes` coverage, and that is what to fix. probe43 claim 2 will
-- go red again the moment this is applied.

DROP POLICY IF EXISTS "homework teacher manage" ON public.homework;

CREATE POLICY "homework teacher manage" ON public.homework
  FOR ALL
  TO authenticated
  USING (
    created_by = (SELECT auth.uid())
    OR public.teacher_teaches_class((SELECT auth.uid()), class_id)
  )
  WITH CHECK (
    created_by = (SELECT auth.uid())
    OR public.teacher_teaches_class((SELECT auth.uid()), class_id)
  );
