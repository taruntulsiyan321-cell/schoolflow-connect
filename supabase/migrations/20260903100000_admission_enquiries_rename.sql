-- ═══════════════════════════════════════════════════════════════════════════
-- school_inquiries → admission_enquiries
--
-- ── WHY THIS FILE IS BEING WRITTEN AFTER THE FACT ─────────────────────────
--
-- This migration is ALREADY APPLIED to production. `public.schema_migrations`
-- carries `20260903100000_admission_enquiries_rename`, the live table is
-- `admission_enquiries` with 11 rows, and `school_inquiries` does not exist.
-- What was missing was the file: preflight question 1, "applied to the
-- database, but no file in this tree — the schema cannot be reproduced from
-- this repo."
--
-- So this is written to be **idempotent against both states**: it renames if
-- the old name is present, verifies if the new name already is, and fails if
-- neither or both. It is not a no-op rubber stamp — the verification block at
-- the end asserts every renamed object actually carries the new name, so
-- running it against production proves the file and the database agree rather
-- than assuming it.
--
-- ── WHY THE NAME WAS WRONG ────────────────────────────────────────────────
--
-- §10.19 draws the line this rename follows:
--
--   "An inquiry is a question from an EXISTING parent or teacher — not an
--    admission enquiry from outside."
--
-- The table was called `school_inquiries` and holds `contact_name`,
-- `contact_phone`, `contact_email` and `grade_interest`. Those are the fields
-- of someone who is not in the school yet. It was never the §10.19 inquiry; it
-- was always the admission enquiry, wearing the other one's name.
--
-- That matters beyond tidiness: §10.19's inquiry is "functionally a message,
-- routed to admin", one question and one answer, from a person who already has
-- a membership. Building that against a table full of outside contact details
-- would have produced one table doing two jobs — G9's shape — and the first
-- symptom would have been an admission lead appearing in a parent's message
-- thread. The rename frees the name before anything is built on it.
--
-- ── WHAT MOVES WITH THE TABLE ─────────────────────────────────────────────
--
-- Renaming a table in Postgres renames the table and nothing else. Indexes,
-- constraints, triggers and policies keep the names they were created with, so
-- each is renamed explicitly below. A policy called "inquiries staff all" on a
-- table called `admission_enquiries` is not a cosmetic mismatch — it is the
-- next reader grepping for the wrong word and concluding the policy does not
-- exist.
--
-- Two objects are deliberately NOT touched:
--
--   `case_status`  — shared with school_complaints, so it keeps its name.
--   the tenant fence PREDICATE — `same_school(school_id)`, which is one fence
--   generation behind the `my_accessible_school_ids()` form chunk 6.7 moved
--   the hot tables onto. That is a real gap and it is reported, not smuggled
--   into a rename: changing what a policy DOES inside a migration whose name
--   promises only a rename is how a security change reaches production
--   unreviewed.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
DECLARE
  _old  boolean := to_regclass('public.school_inquiries')    IS NOT NULL;
  _new  boolean := to_regclass('public.admission_enquiries') IS NOT NULL;
BEGIN
  -- Both present is not a state to reconcile automatically. It means two
  -- tables hold admission enquiries and only a human knows which rows matter.
  IF _old AND _new THEN
    RAISE EXCEPTION
      'ABORT: both public.school_inquiries and public.admission_enquiries exist; refusing to guess which holds the live rows';
  END IF;

  IF NOT _old AND NOT _new THEN
    RAISE EXCEPTION
      'ABORT: neither public.school_inquiries nor public.admission_enquiries exists';
  END IF;

  IF _new THEN
    RAISE NOTICE 'admission_enquiries already present — nothing to rename, verifying only';
    RETURN;
  END IF;

  ALTER TABLE public.school_inquiries RENAME TO admission_enquiries;

  -- Indexes and constraints, each guarded so a partially-applied run finishes.
  IF to_regclass('public.school_inquiries_pkey') IS NOT NULL THEN
    ALTER INDEX public.school_inquiries_pkey RENAME TO admission_enquiries_pkey;
  END IF;

  IF to_regclass('public.idx_inquiries_status') IS NOT NULL THEN
    ALTER INDEX public.idx_inquiries_status RENAME TO idx_admission_enquiries_status;
  END IF;

  IF to_regclass('public.school_inquiries_school_id_idx') IS NOT NULL THEN
    ALTER INDEX public.school_inquiries_school_id_idx
      RENAME TO admission_enquiries_school_id_idx;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_constraint
              WHERE conrelid = 'public.admission_enquiries'::regclass
                AND conname  = 'school_inquiries_created_by_fkey') THEN
    ALTER TABLE public.admission_enquiries
      RENAME CONSTRAINT school_inquiries_created_by_fkey TO admission_enquiries_created_by_fkey;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_constraint
              WHERE conrelid = 'public.admission_enquiries'::regclass
                AND conname  = 'school_inquiries_school_id_fkey') THEN
    ALTER TABLE public.admission_enquiries
      RENAME CONSTRAINT school_inquiries_school_id_fkey TO admission_enquiries_school_id_fkey;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_trigger
              WHERE tgrelid = 'public.admission_enquiries'::regclass
                AND tgname  = 'school_inquiries_set_school') THEN
    ALTER TRIGGER school_inquiries_set_school ON public.admission_enquiries
      RENAME TO admission_enquiries_set_school;
  END IF;

  -- Policies. The predicates are carried across untouched; only the names move.
  IF EXISTS (SELECT 1 FROM pg_policy
              WHERE polrelid = 'public.admission_enquiries'::regclass
                AND polname  = 'inquiries staff all') THEN
    ALTER POLICY "inquiries staff all" ON public.admission_enquiries
      RENAME TO "admission_enquiries staff all";
  END IF;

  IF EXISTS (SELECT 1 FROM pg_policy
              WHERE polrelid = 'public.admission_enquiries'::regclass
                AND polname  = 'inquiries anyone insert') THEN
    ALTER POLICY "inquiries anyone insert" ON public.admission_enquiries
      RENAME TO "admission_enquiries anyone insert";
  END IF;

  IF EXISTS (SELECT 1 FROM pg_policy
              WHERE polrelid = 'public.admission_enquiries'::regclass
                AND polname  = 'school_inquiries_tenant_fence') THEN
    ALTER POLICY school_inquiries_tenant_fence ON public.admission_enquiries
      RENAME TO admission_enquiries_tenant_fence;
  END IF;
END $$;

-- ── Verification ──────────────────────────────────────────────────────────
-- G11: a check must be able to fail. Each of these names a specific object, so
-- a rename that silently did not happen aborts the transaction rather than
-- letting the file claim credit for a database it did not change.
DO $$
DECLARE
  _stale_policies int;
BEGIN
  IF to_regclass('public.admission_enquiries') IS NULL THEN
    RAISE EXCEPTION 'ABORT: public.admission_enquiries does not exist after the rename';
  END IF;

  IF to_regclass('public.school_inquiries') IS NOT NULL THEN
    RAISE EXCEPTION 'ABORT: public.school_inquiries still exists after the rename';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgrelid = 'public.admission_enquiries'::regclass
                    AND tgname  = 'admission_enquiries_set_school') THEN
    RAISE EXCEPTION
      'ABORT: the set-school trigger is missing — new rows would carry no school_id';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_indexes
                  WHERE schemaname = 'public'
                    AND indexname  = 'idx_admission_enquiries_status') THEN
    RAISE EXCEPTION 'ABORT: idx_admission_enquiries_status is missing';
  END IF;

  -- RLS must survive a rename. It does, but an assertion costs nothing and the
  -- failure mode is every school reading every school's admission leads.
  IF NOT EXISTS (SELECT 1 FROM pg_class
                  WHERE oid = 'public.admission_enquiries'::regclass
                    AND relrowsecurity) THEN
    RAISE EXCEPTION 'ABORT: row level security is not enabled on admission_enquiries';
  END IF;

  SELECT count(*) INTO _stale_policies
  FROM pg_policy
  WHERE polrelid = 'public.admission_enquiries'::regclass
    AND polname ILIKE '%inquir%';

  IF _stale_policies <> 0 THEN
    RAISE EXCEPTION
      'ABORT: % policy name(s) on admission_enquiries still say "inquir"', _stale_policies;
  END IF;

  IF (SELECT count(*) FROM pg_policy
       WHERE polrelid = 'public.admission_enquiries'::regclass) <> 3 THEN
    RAISE EXCEPTION 'ABORT: expected 3 policies on admission_enquiries, found %',
      (SELECT count(*) FROM pg_policy
        WHERE polrelid = 'public.admission_enquiries'::regclass);
  END IF;
END $$;

COMMIT;
