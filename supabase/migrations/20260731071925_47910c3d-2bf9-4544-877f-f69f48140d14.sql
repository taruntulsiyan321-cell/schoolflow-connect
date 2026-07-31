-- 1. Fix broken parent condition on class/section notices
DROP POLICY IF EXISTS "notices read class" ON public.notices;
CREATE POLICY "notices read class" ON public.notices
FOR SELECT TO authenticated
USING (
  audience = 'class'::notice_audience
  AND class_id IS NOT NULL
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
CREATE POLICY "notices read section" ON public.notices
FOR SELECT TO authenticated
USING (
  audience = 'section'::notice_audience
  AND class_id IS NOT NULL
  AND (
    student_class_id(auth.uid()) = class_id
    OR teacher_teaches_class(auth.uid(), class_id)
    OR EXISTS (
      SELECT 1 FROM public.students s
      WHERE s.parent_user_id = auth.uid() AND s.class_id = notices.class_id
    )
  )
);

-- 2. Stop exposing teacher email/mobile/salary/address to every authenticated user
DROP POLICY IF EXISTS "teachers public basic read" ON public.teachers;
CREATE POLICY "teachers privileged read" ON public.teachers
FOR SELECT TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'principal'::app_role)
  OR user_id = auth.uid()
);

-- Safe, non-sensitive directory for everyone else
CREATE OR REPLACE VIEW public.teacher_directory AS
SELECT id, full_name, subject, department, qualification, photo_url,
       is_class_teacher, class_teacher_of, status, school_id
FROM public.teachers;

GRANT SELECT ON public.teacher_directory TO authenticated;
GRANT ALL ON public.teacher_directory TO service_role;