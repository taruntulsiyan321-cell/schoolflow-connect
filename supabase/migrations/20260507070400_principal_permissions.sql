-- ============================================================
-- PRINCIPAL PERMISSIONS ENHANCEMENT
-- ============================================================

-- Drop old policies
DROP POLICY IF EXISTS "classes admin write" ON public.classes;
DROP POLICY IF EXISTS "students admin all" ON public.students;

-- Allow both admins and principals to manage classes
CREATE POLICY "classes admin and principal write" ON public.classes FOR ALL
  USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role IN ('admin', 'principal')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role IN ('admin', 'principal')));

-- Allow both admins and principals to manage students
CREATE POLICY "students admin and principal all" ON public.students FOR ALL
  USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role IN ('admin', 'principal')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role IN ('admin', 'principal')));
