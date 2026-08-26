-- =====================================================================
-- REVERSE OF: 20260825130000_chunk1_membership_fence.sql
--
-- Restores the four identity helpers and the seven person-path policies to
-- the exact bodies read live from the database on 2026-08-25 before the fence
-- was applied. Running this re-opens the 80 cross-institution leaks the fence
-- closed; that is what "reverse" means here.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.student_class_id(_user_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT class_id FROM public.students WHERE user_id = _user_id LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.teacher_teaches_class(_user_id uuid, _class_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.teacher_classes tc
    JOIN public.teachers t ON t.id = tc.teacher_id
    WHERE t.user_id = _user_id AND tc.class_id = _class_id
  ) OR EXISTS (
    SELECT 1 FROM public.teachers t
    WHERE t.user_id = _user_id AND t.class_teacher_of = _class_id
  )
$$;

CREATE OR REPLACE FUNCTION public.is_class_teacher_of_class(_uid uuid, _class_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.teachers t
    WHERE t.user_id = _uid AND t.class_teacher_of = _class_id
  )
$$;

CREATE OR REPLACE FUNCTION public.teacher_teaches_class_subject(
  _user_id uuid, _class_id uuid, _subject text DEFAULT NULL::text, _subject_id uuid DEFAULT NULL::uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.teacher_classes tc
    JOIN public.teachers t ON t.id = tc.teacher_id
    WHERE t.user_id = _user_id
      AND tc.class_id = _class_id
      AND (
        (_subject_id IS NOT NULL AND tc.subject_id IS NOT NULL AND tc.subject_id = _subject_id)
        OR (
          _subject IS NOT NULL
          AND NULLIF(trim(_subject), '') IS NOT NULL
          AND lower(trim(COALESCE(tc.subject, ''))) = lower(trim(_subject))
        )
        OR (
          _subject_id IS NOT NULL
          AND tc.subject_id IS NULL
          AND NULLIF(trim(COALESCE(tc.subject, '')), '') IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM public.subjects s
            WHERE s.id = _subject_id
              AND lower(trim(s.name)) = lower(trim(tc.subject))
          )
        )
      )
  );
$$;

DROP POLICY IF EXISTS "students self read" ON public.students;
CREATE POLICY "students self read" ON public.students
  FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS "students parent read" ON public.students;
CREATE POLICY "students parent read" ON public.students
  FOR SELECT USING (
    parent_user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.parent_students ps
      JOIN public.parents p ON p.id = ps.parent_id
      WHERE ps.student_id = students.id AND p.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "teachers self read" ON public.teachers;
CREATE POLICY "teachers self read" ON public.teachers
  FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS "teachers school staff read" ON public.teachers;
CREATE POLICY "teachers school staff read" ON public.teachers
  FOR SELECT USING (
    user_id = auth.uid()
    OR ((public.has_role(auth.uid(), 'principal'::public.app_role)
      OR public.has_role(auth.uid(), 'admin'::public.app_role))
      AND public.same_school(school_id))
  );

DROP POLICY IF EXISTS parents_school_select ON public.parents;
CREATE POLICY parents_school_select ON public.parents
  FOR SELECT USING (
    user_id = auth.uid()
    OR (public.same_school(school_id)
      AND (public.has_role(auth.uid(), 'admin'::public.app_role)
        OR public.has_role(auth.uid(), 'principal'::public.app_role)))
  );

DROP POLICY IF EXISTS parents_self_update ON public.parents;
CREATE POLICY parents_self_update ON public.parents
  FOR UPDATE USING (user_id = auth.uid());

DROP POLICY IF EXISTS parent_students_select ON public.parent_students;
CREATE POLICY parent_students_select ON public.parent_students
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.parents p
      WHERE p.id = parent_students.parent_id AND p.user_id = auth.uid()
    )
    OR (public.same_school(school_id)
      AND (public.has_role(auth.uid(), 'admin'::public.app_role)
        OR public.has_role(auth.uid(), 'principal'::public.app_role)))
  );

DELETE FROM public.schema_migrations
 WHERE version = '20260825130000_chunk1_membership_fence';
