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