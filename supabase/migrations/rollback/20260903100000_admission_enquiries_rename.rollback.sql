-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK — admission_enquiries → school_inquiries
--
-- Reverses 20260903100000_admission_enquiries_rename.sql exactly: the same
-- objects, the same order, the old names.
--
-- NO DATA IS TOUCHED. A rename moves no rows, so this is reversible without
-- loss in either direction — which is the one genuinely comfortable property
-- of this migration and the reason it could be written after the fact at all.
--
-- WHAT THIS DOES NOT UNDO: the client repoint and the regenerated
-- `src/integrations/supabase/types.ts` that shipped with the rename. Running
-- this against production without also reverting that code leaves the two
-- screens querying `admission_enquiries` against a database that no longer has
-- it — the same break this migration was written to close, pointing the other
-- way. Revert the commit, not just the schema.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
DECLARE
  _old boolean := to_regclass('public.school_inquiries')    IS NOT NULL;
  _new boolean := to_regclass('public.admission_enquiries') IS NOT NULL;
BEGIN
  IF _old AND _new THEN
    RAISE EXCEPTION
      'ABORT: both names exist; refusing to guess which holds the live rows';
  END IF;

  IF _old AND NOT _new THEN
    RAISE NOTICE 'school_inquiries already present — nothing to roll back';
    RETURN;
  END IF;

  IF NOT _new THEN
    RAISE EXCEPTION 'ABORT: public.admission_enquiries does not exist';
  END IF;

  ALTER TABLE public.admission_enquiries RENAME TO school_inquiries;

  IF to_regclass('public.admission_enquiries_pkey') IS NOT NULL THEN
    ALTER INDEX public.admission_enquiries_pkey RENAME TO school_inquiries_pkey;
  END IF;

  IF to_regclass('public.idx_admission_enquiries_status') IS NOT NULL THEN
    ALTER INDEX public.idx_admission_enquiries_status RENAME TO idx_inquiries_status;
  END IF;

  IF to_regclass('public.admission_enquiries_school_id_idx') IS NOT NULL THEN
    ALTER INDEX public.admission_enquiries_school_id_idx
      RENAME TO school_inquiries_school_id_idx;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_constraint
              WHERE conrelid = 'public.school_inquiries'::regclass
                AND conname  = 'admission_enquiries_created_by_fkey') THEN
    ALTER TABLE public.school_inquiries
      RENAME CONSTRAINT admission_enquiries_created_by_fkey TO school_inquiries_created_by_fkey;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_constraint
              WHERE conrelid = 'public.school_inquiries'::regclass
                AND conname  = 'admission_enquiries_school_id_fkey') THEN
    ALTER TABLE public.school_inquiries
      RENAME CONSTRAINT admission_enquiries_school_id_fkey TO school_inquiries_school_id_fkey;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_trigger
              WHERE tgrelid = 'public.school_inquiries'::regclass
                AND tgname  = 'admission_enquiries_set_school') THEN
    ALTER TRIGGER admission_enquiries_set_school ON public.school_inquiries
      RENAME TO school_inquiries_set_school;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_policy
              WHERE polrelid = 'public.school_inquiries'::regclass
                AND polname  = 'admission_enquiries staff all') THEN
    ALTER POLICY "admission_enquiries staff all" ON public.school_inquiries
      RENAME TO "inquiries staff all";
  END IF;

  IF EXISTS (SELECT 1 FROM pg_policy
              WHERE polrelid = 'public.school_inquiries'::regclass
                AND polname  = 'admission_enquiries anyone insert') THEN
    ALTER POLICY "admission_enquiries anyone insert" ON public.school_inquiries
      RENAME TO "inquiries anyone insert";
  END IF;

  IF EXISTS (SELECT 1 FROM pg_policy
              WHERE polrelid = 'public.school_inquiries'::regclass
                AND polname  = 'admission_enquiries_tenant_fence') THEN
    ALTER POLICY admission_enquiries_tenant_fence ON public.school_inquiries
      RENAME TO school_inquiries_tenant_fence;
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.school_inquiries') IS NULL THEN
    RAISE EXCEPTION 'ABORT: public.school_inquiries does not exist after the rollback';
  END IF;

  IF to_regclass('public.admission_enquiries') IS NOT NULL THEN
    RAISE EXCEPTION 'ABORT: public.admission_enquiries still exists after the rollback';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_class
                  WHERE oid = 'public.school_inquiries'::regclass AND relrowsecurity) THEN
    RAISE EXCEPTION 'ABORT: row level security is not enabled on school_inquiries';
  END IF;
END $$;

DELETE FROM public.schema_migrations
 WHERE version = '20260903100000_admission_enquiries_rename';

COMMIT;
