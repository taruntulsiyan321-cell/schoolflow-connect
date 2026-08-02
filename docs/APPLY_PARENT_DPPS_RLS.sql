-- NOTE: Tenant predicates updated by APPLY_QA_AUDITOR_DB_API_AUTH.sql (prefer that after this).

-- =============================================================================
-- APPLY_PARENT_DPPS_RLS.sql  (Meta-Supervisor 1 / SupB)
-- Paste into Supabase SQL Editor. Idempotent.
--
-- Gap: parents had no SELECT on public.dpps / child dpp_attempts, so
-- ParentLiveExams → TestService.listForClass always returned empty under RLS.
-- =============================================================================

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

-- Verify:
-- SELECT policyname, tablename FROM pg_policies
-- WHERE tablename IN ('dpps','dpp_attempts') AND policyname LIKE '%parent%';
