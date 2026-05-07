-- ============================================================
-- PARENT READ ACCESS FOR HOMEWORK
-- ============================================================

-- Parents can view homework for their children's classes
CREATE POLICY "Parents can view homework for their children"
  ON public.homework FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.students s
      WHERE s.parent_user_id = auth.uid() AND s.class_id = homework.class_id
    )
  );

-- Parents can view submissions of their children
CREATE POLICY "Parents can view submissions of their children"
  ON public.homework_submissions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.students s
      WHERE s.parent_user_id = auth.uid() AND s.id = homework_submissions.student_id
    )
  );
