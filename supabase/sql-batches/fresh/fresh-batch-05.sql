-- FRESH DATABASE batch 5/12
-- For NEW empty Supabase project (paste in SQL Editor → Run)
-- Project: imrsjhftejghcrhzdjrl

-- ── 20260508081059_auto_link_user.sql




-- ── 20260509043436_082fbd57-94b8-4ee0-96e9-7828abc3d183.sql

ALTER TABLE public.teachers
  ADD COLUMN IF NOT EXISTS address text,
  ADD COLUMN IF NOT EXISTS employee_id text,
  ADD COLUMN IF NOT EXISTS department text,
  ADD COLUMN IF NOT EXISTS qualification text,
  ADD COLUMN IF NOT EXISTS joining_date date,
  ADD COLUMN IF NOT EXISTS photo_url text,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS notes text;

ALTER TABLE public.notices
  ADD COLUMN IF NOT EXISTS revoked_at timestamptz;

DROP POLICY IF EXISTS "notices publisher update" ON public.notices;
CREATE POLICY "notices publisher update"
  ON public.notices FOR UPDATE
  TO authenticated
  USING (posted_by = auth.uid() OR has_role(auth.uid(),'admin'))
  WITH CHECK (posted_by = auth.uid() OR has_role(auth.uid(),'admin'));

DROP POLICY IF EXISTS "notices publisher delete" ON public.notices;
CREATE POLICY "notices publisher delete"
  ON public.notices FOR DELETE
  TO authenticated
  USING (posted_by = auth.uid() OR has_role(auth.uid(),'admin'));


-- ── 20260509050014_82804dfc-5e64-4ca4-9cd4-de237f8d0700.sql

-- First, drop ALL existing policies on notices using a DO block
DO $$
DECLARE pol RECORD;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies WHERE tablename = 'notices' AND schemaname = 'public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.notices', pol.policyname);
  END LOOP;
END $$;

-- Admin: full access
CREATE POLICY "notices admin full"
  ON public.notices FOR ALL TO public
  USING (has_role(auth.uid(), 'admin'))
  WITH CHECK (has_role(auth.uid(), 'admin'));

-- Principal: full access (this is what the user asked for)
CREATE POLICY "notices principal full"
  ON public.notices FOR ALL TO public
  USING (has_role(auth.uid(), 'principal'))
  WITH CHECK (has_role(auth.uid(), 'principal'));

-- Publisher: can manage their own notices
CREATE POLICY "notices publisher own"
  ON public.notices FOR ALL TO authenticated
  USING (posted_by = auth.uid())
  WITH CHECK (posted_by = auth.uid());

-- Teacher: can post/manage for classes they teach
CREATE POLICY "notices teacher class"
  ON public.notices FOR ALL TO public
  USING (
    has_role(auth.uid(), 'teacher') AND (
      class_id IS NULL OR teacher_teaches_class(auth.uid(), class_id)
    )
  )
  WITH CHECK (
    has_role(auth.uid(), 'teacher') AND (
      class_id IS NULL OR teacher_teaches_class(auth.uid(), class_id)
    )
  );

-- Read: audience = all
CREATE POLICY "notices read all"
  ON public.notices FOR SELECT TO authenticated
  USING (audience = 'all');

-- Read: audience = teachers
CREATE POLICY "notices read teachers"
  ON public.notices FOR SELECT TO public
  USING (audience = 'teachers' AND has_role(auth.uid(), 'teacher'));

-- Read: audience = parents
CREATE POLICY "notices read parents"
  ON public.notices FOR SELECT TO public
  USING (audience = 'parents' AND has_role(auth.uid(), 'parent'));

-- Read: audience = students
CREATE POLICY "notices read students"
  ON public.notices FOR SELECT TO public
  USING (audience = 'students' AND has_role(auth.uid(), 'student'));

-- Read: class-targeted notices
CREATE POLICY "notices read class"
  ON public.notices FOR SELECT TO public
  USING (
    audience = 'class' AND class_id IS NOT NULL AND (
      student_class_id(auth.uid()) = class_id OR
      teacher_teaches_class(auth.uid(), class_id) OR
      EXISTS (SELECT 1 FROM students s WHERE s.parent_user_id = auth.uid() AND s.class_id = class_id)
    )
  );

-- Read: section-targeted notices
CREATE POLICY "notices read section"
  ON public.notices FOR SELECT TO public
  USING (
    audience = 'section' AND class_id IS NOT NULL AND (
      student_class_id(auth.uid()) = class_id OR
      teacher_teaches_class(auth.uid(), class_id) OR
      EXISTS (SELECT 1 FROM students s WHERE s.parent_user_id = auth.uid() AND s.class_id = class_id)
    )
  );

-- Ensure RLS is enabled
ALTER TABLE public.notices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notices FORCE ROW LEVEL SECURITY;

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_notices_posted_by ON public.notices(posted_by);
CREATE INDEX IF NOT EXISTS idx_notices_audience ON public.notices(audience);
CREATE INDEX IF NOT EXISTS idx_notices_class_id ON public.notices(class_id);
CREATE INDEX IF NOT EXISTS idx_notices_created_at ON public.notices(created_at DESC);


-- ── 20260509063855_0a2e44ec-a79e-4ff3-81d4-4379902acd8b.sql

CREATE OR REPLACE FUNCTION public.ensure_default_role()
RETURNS app_role
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _uid uuid := auth.uid(); _existing app_role;
BEGIN
  IF _uid IS NULL THEN RETURN NULL; END IF;
  SELECT role INTO _existing FROM public.user_roles WHERE user_id = _uid LIMIT 1;
  IF _existing IS NOT NULL THEN RETURN _existing; END IF;
  INSERT INTO public.user_roles (user_id, role) VALUES (_uid, 'student')
    ON CONFLICT (user_id, role) DO NOTHING;
  RETURN 'student'::app_role;
END; $$;

