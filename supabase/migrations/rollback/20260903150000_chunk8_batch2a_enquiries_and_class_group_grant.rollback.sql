-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK — CHUNK 8 BATCH 2a
--
-- Reverses both halves exactly. Nothing here restores a snapshot (G16): the
-- rename is reversed by renaming back, and the grant by revoking the one role
-- the migration added, not by reassigning an ACL wholesale.
--
-- WHAT ROLLING BACK COSTS
--
-- Revoking rpc_create_class_group returns class-group creation to unreachable —
-- which was the live break. Roll this half back only if the grant caused
-- something worse than the break it fixed.
--
-- The rename is lossless in both directions; the rows never move. But if the
-- client has already been repointed to `admission_enquiries` (step 3 of the
-- deploy coupling in the forward migration), rolling back the database ALONE
-- breaks the principal's cases screen the other way round. Roll back the client
-- in the same step.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 2. Undo the rename ────────────────────────────────────────────────────

ALTER POLICY "admission_enquiries staff manage" ON public.admission_enquiries
  RENAME TO "inquiries staff all";

ALTER POLICY "admission_enquiries insert own school signed in" ON public.admission_enquiries
  RENAME TO "inquiries anyone insert";

ALTER POLICY "admission_enquiries_tenant_fence" ON public.admission_enquiries
  RENAME TO "school_inquiries_tenant_fence";

ALTER TRIGGER admission_enquiries_set_school ON public.admission_enquiries
  RENAME TO school_inquiries_set_school;

ALTER TABLE public.admission_enquiries RENAME CONSTRAINT admission_enquiries_created_by_fkey TO school_inquiries_created_by_fkey;
ALTER TABLE public.admission_enquiries RENAME CONSTRAINT admission_enquiries_school_id_fkey TO school_inquiries_school_id_fkey;
ALTER TABLE public.admission_enquiries RENAME CONSTRAINT admission_enquiries_pkey TO school_inquiries_pkey;

ALTER TABLE public.admission_enquiries RENAME TO school_inquiries;

-- ── 1. Undo the grant ─────────────────────────────────────────────────────

REVOKE EXECUTE ON FUNCTION public.rpc_create_class_group(uuid, text) FROM authenticated;

-- ── Prove the reversal ────────────────────────────────────────────────────

DO $$
DECLARE _n int;
BEGIN
  SELECT count(*) INTO _n FROM information_schema.tables
   WHERE table_schema='public' AND table_name='school_inquiries';
  IF _n <> 1 THEN RAISE EXCEPTION 'school_inquiries was not restored'; END IF;

  SELECT count(*) INTO _n FROM pg_policies
   WHERE schemaname='public' AND tablename='school_inquiries';
  IF _n <> 3 THEN RAISE EXCEPTION 'expected 3 policies restored, found %', _n; END IF;

  IF has_function_privilege('authenticated', 'public.rpc_create_class_group(uuid, text)'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION 'the grant survived the rollback';
  END IF;
END $$;

COMMIT;
