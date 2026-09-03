-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK — complaints INSERT returns to any authenticated user
--
-- Restores `complaints submit` without its role test and `complaints staff all`
-- as a single FOR ALL policy, exactly as 20260802540000 left them.
--
-- BE CLEAR ABOUT WHAT THIS RESTORES: it re-opens complaint authorship to every
-- authenticated user with a school, which is Chunk 8 verification item 5
-- failing again ("Teacher attempts to raise a complaint — rejected"). Run it
-- only to unblock something the narrowing broke, and expect item 5 to go red
-- until it is re-applied.
--
-- No data is touched. Policies carry no rows.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DROP POLICY IF EXISTS "complaints staff update" ON public.school_complaints;
DROP POLICY IF EXISTS "complaints staff delete" ON public.school_complaints;

DROP POLICY IF EXISTS "complaints staff all" ON public.school_complaints;
CREATE POLICY "complaints staff all" ON public.school_complaints
  FOR ALL TO authenticated
  USING (
    public.same_school(school_id)
    AND (
      public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_role(auth.uid(), 'principal'::public.app_role)
    )
  )
  WITH CHECK (
    public.same_school(school_id)
    AND (
      public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_role(auth.uid(), 'principal'::public.app_role)
    )
  );

DROP POLICY IF EXISTS "complaints submit" ON public.school_complaints;
CREATE POLICY "complaints submit" ON public.school_complaints
  FOR INSERT TO authenticated
  WITH CHECK (
    submitted_by = auth.uid()
    AND school_id = public.get_my_school_id()
  );

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy
                  WHERE polrelid = 'public.school_complaints'::regclass
                    AND polname = 'complaints staff all') THEN
    RAISE EXCEPTION 'ABORT: "complaints staff all" was not restored';
  END IF;
END $$;

DELETE FROM public.schema_migrations
 WHERE version = '20260903130000_complaints_parent_only_insert';

COMMIT;
