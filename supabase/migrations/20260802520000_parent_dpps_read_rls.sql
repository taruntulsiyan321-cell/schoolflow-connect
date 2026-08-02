-- Parent can read published class tests (dpps) and linked child attempts.
-- Without this, ParentLiveExams TestService.listForClass returns [] under RLS.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'dpps' AND policyname = 'dpps parent read published'
  ) THEN
    CREATE POLICY "dpps parent read published" ON public.dpps
      FOR SELECT
      USING (
        public.has_role(auth.uid(), 'parent'::public.app_role)
        AND COALESCE(is_published, false) = true
        AND EXISTS (
          SELECT 1 FROM public.students s
          WHERE s.parent_user_id = auth.uid()
            AND s.class_id = dpps.class_id
        )
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'dpp_attempts' AND policyname = 'dppa parent read child'
  ) THEN
    CREATE POLICY "dppa parent read child" ON public.dpp_attempts
      FOR SELECT
      USING (
        public.has_role(auth.uid(), 'parent'::public.app_role)
        AND EXISTS (
          SELECT 1 FROM public.students s
          WHERE s.parent_user_id = auth.uid()
            AND s.user_id = dpp_attempts.user_id
        )
      );
  END IF;
END $$;
