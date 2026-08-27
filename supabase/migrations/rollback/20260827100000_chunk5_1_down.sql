-- =====================================================================
-- REVERSE OF: 20260827100000_chunk5_1_rls_performance.sql
--
-- Restores the pre-optimisation policies, including the duplicate stacks.
--
-- WHAT THIS COSTS, plainly: running it puts the parent panel back over the 8 s
-- statement timeout — /rest/v1/homework_submissions returns HTTP 500 again.
-- It also restores the principal's full write on homework_submissions, which
-- 5.1 deliberately tightened to read-only. Reverse only to isolate a problem,
-- not as a resting state.
-- =====================================================================

-- 1. homework_submissions: the older duplicate set, as it was.
DROP POLICY IF EXISTS "hw_sub parent read"   ON public.homework_submissions;
CREATE POLICY "hw_sub parent read" ON public.homework_submissions
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.students s
             WHERE s.id = homework_submissions.student_id
               AND (s.parent_user_id = auth.uid()
                 OR EXISTS (SELECT 1 FROM public.parent_students ps
                              JOIN public.parents p ON p.id = ps.parent_id
                             WHERE ps.student_id = s.id AND p.user_id = auth.uid()))));

DROP POLICY IF EXISTS "hw_sub student own" ON public.homework_submissions;
CREATE POLICY "hw_sub student own" ON public.homework_submissions
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.students s
             WHERE s.user_id = auth.uid() AND s.id = homework_submissions.student_id));

DROP POLICY IF EXISTS "hw_sub teacher manage" ON public.homework_submissions;
CREATE POLICY "hw_sub teacher manage" ON public.homework_submissions
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.homework h
             WHERE h.id = homework_submissions.homework_id
               AND public.teacher_teaches_class(auth.uid(), h.class_id)));

CREATE POLICY "Admins can manage all submissions" ON public.homework_submissions
  FOR ALL USING ((public.has_role(auth.uid(), 'admin'::public.app_role)
               OR public.has_role(auth.uid(), 'principal'::public.app_role))
              AND public.same_school(school_id));

-- 2. homework: the duplicate stack.
DROP POLICY IF EXISTS "homework parent read" ON public.homework;
CREATE POLICY "homework parent read" ON public.homework
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.students s
             WHERE s.class_id = homework.class_id
               AND (s.parent_user_id = auth.uid()
                 OR EXISTS (SELECT 1 FROM public.parent_students ps
                              JOIN public.parents p ON p.id = ps.parent_id
                             WHERE ps.student_id = s.id AND p.user_id = auth.uid()))));

DROP POLICY IF EXISTS "homework teacher manage" ON public.homework;
CREATE POLICY "homework teacher manage" ON public.homework
  FOR ALL USING (public.teacher_teaches_class(auth.uid(), class_id));

CREATE POLICY "Students can view homework for their class" ON public.homework
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.students s
             WHERE s.user_id = auth.uid() AND s.class_id = homework.class_id));

-- 3. attendance, fees, leave_requests, activity: back to the nested form.
DROP POLICY IF EXISTS "att student read self" ON public.attendance;
CREATE POLICY "att student read self" ON public.attendance
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.students s
             WHERE s.id = attendance.student_id AND s.user_id = auth.uid()));

DROP POLICY IF EXISTS "att parent read child" ON public.attendance;
CREATE POLICY "att parent read child" ON public.attendance
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.students s
             WHERE s.id = attendance.student_id
               AND (s.parent_user_id = auth.uid()
                 OR EXISTS (SELECT 1 FROM public.parent_students ps
                              JOIN public.parents p ON p.id = ps.parent_id
                             WHERE ps.student_id = s.id AND p.user_id = auth.uid()))));

DROP POLICY IF EXISTS "fees parent read" ON public.fees;
CREATE POLICY "fees parent read" ON public.fees
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.students s
             WHERE s.id = fees.student_id
               AND (s.parent_user_id = auth.uid()
                 OR EXISTS (SELECT 1 FROM public.parent_students ps
                              JOIN public.parents p ON p.id = ps.parent_id
                             WHERE ps.student_id = s.id AND p.user_id = auth.uid()))));

DROP POLICY IF EXISTS "fees student read" ON public.fees;
CREATE POLICY "fees student read" ON public.fees
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.students s
             WHERE s.id = fees.student_id AND s.user_id = auth.uid()));

DROP POLICY IF EXISTS "leaves parent read child" ON public.leave_requests;
CREATE POLICY "leaves parent read child" ON public.leave_requests
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.students s
             WHERE s.id = leave_requests.student_id
               AND (s.parent_user_id = auth.uid()
                 OR EXISTS (SELECT 1 FROM public.parent_students ps
                              JOIN public.parents p ON p.id = ps.parent_id
                             WHERE ps.student_id = s.id AND p.user_id = auth.uid()))));

DROP POLICY IF EXISTS "activity parent" ON public.academic_daily_activity;
CREATE POLICY "activity parent" ON public.academic_daily_activity
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.students s
             WHERE s.user_id = academic_daily_activity.user_id
               AND (s.parent_user_id = auth.uid()
                 OR EXISTS (SELECT 1 FROM public.parent_students ps
                              JOIN public.parents p ON p.id = ps.parent_id
                             WHERE ps.student_id = s.id AND p.user_id = auth.uid()))));

-- 4. Chunk 5's own tables, back to the nested form.
DROP POLICY IF EXISTS homework_answers_parent_read ON public.homework_answers;
CREATE POLICY homework_answers_parent_read ON public.homework_answers
  FOR SELECT USING (
    public.active_membership_role() = 'parent'
    AND EXISTS (SELECT 1 FROM public.parent_students ps
                 WHERE ps.student_id = homework_answers.student_id
                   AND ps.parent_id = public.active_local_person_id()));

DROP POLICY IF EXISTS homework_answers_student_own ON public.homework_answers;
CREATE POLICY homework_answers_student_own ON public.homework_answers
  FOR ALL
  USING (public.active_membership_role() = 'student'
     AND student_id = public.active_local_person_id())
  WITH CHECK (public.active_membership_role() = 'student'
     AND student_id = public.active_local_person_id());

DROP POLICY IF EXISTS homework_completions_parent_read ON public.homework_completions;
CREATE POLICY homework_completions_parent_read ON public.homework_completions
  FOR SELECT USING (
    public.active_membership_role() = 'parent'
    AND EXISTS (SELECT 1 FROM public.parent_students ps
                 WHERE ps.student_id = homework_completions.student_id
                   AND ps.parent_id = public.active_local_person_id()));

DROP POLICY IF EXISTS homework_completions_student_own ON public.homework_completions;
CREATE POLICY homework_completions_student_own ON public.homework_completions
  FOR SELECT USING (public.active_membership_role() = 'student'
     AND student_id = public.active_local_person_id());

-- 5. The helpers (dropped last: the policies above no longer reference them).
DROP FUNCTION IF EXISTS public.can_manage_homework(uuid);
DROP FUNCTION IF EXISTS public.is_class_of_my_child(uuid);
DROP FUNCTION IF EXISTS public.is_my_child(uuid);
DROP FUNCTION IF EXISTS public.is_my_student_record(uuid);

DELETE FROM public.schema_migrations
 WHERE version = '20260827100000_chunk5_1_rls_performance';
