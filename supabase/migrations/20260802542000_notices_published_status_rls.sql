-- Gate student/parent notice reads to published + non-revoked rows.
-- Prevents draft/scheduled teacher announcements from leaking via RLS SELECT.

DROP POLICY IF EXISTS "notices read all" ON public.notices;
CREATE POLICY "notices read all"
  ON public.notices FOR SELECT TO authenticated
  USING (
    audience = 'all'
    AND status = 'published'
    AND revoked_at IS NULL
  );

DROP POLICY IF EXISTS "notices read students" ON public.notices;
CREATE POLICY "notices read students"
  ON public.notices FOR SELECT TO authenticated
  USING (
    audience = 'students'
    AND status = 'published'
    AND revoked_at IS NULL
    AND has_role(auth.uid(), 'student')
  );

DROP POLICY IF EXISTS "notices read parents" ON public.notices;
CREATE POLICY "notices read parents"
  ON public.notices FOR SELECT TO authenticated
  USING (
    audience = 'parents'
    AND status = 'published'
    AND revoked_at IS NULL
    AND has_role(auth.uid(), 'parent')
  );

DROP POLICY IF EXISTS "notices read class" ON public.notices;
CREATE POLICY "notices read class"
  ON public.notices FOR SELECT TO authenticated
  USING (
    audience = 'class'::notice_audience
    AND class_id IS NOT NULL
    AND status = 'published'
    AND revoked_at IS NULL
    AND (
      student_class_id(auth.uid()) = class_id
      OR teacher_teaches_class(auth.uid(), class_id)
      OR EXISTS (
        SELECT 1 FROM public.students s
        WHERE s.parent_user_id = auth.uid() AND s.class_id = notices.class_id
      )
    )
  );

DROP POLICY IF EXISTS "notices read section" ON public.notices;
CREATE POLICY "notices read section"
  ON public.notices FOR SELECT TO authenticated
  USING (
    audience = 'section'::notice_audience
    AND class_id IS NOT NULL
    AND status = 'published'
    AND revoked_at IS NULL
    AND (
      student_class_id(auth.uid()) = class_id
      OR teacher_teaches_class(auth.uid(), class_id)
      OR EXISTS (
        SELECT 1 FROM public.students s
        WHERE s.parent_user_id = auth.uid() AND s.class_id = notices.class_id
      )
    )
  );
