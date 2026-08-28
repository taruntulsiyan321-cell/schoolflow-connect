-- ═══════════════════════════════════════════════════════════════════════════
-- REVERSE OF: 20260828180000_chunk7b_batch2_practice_fences.sql
--
-- Puts the six practice tenant fences back on per-row same_school() and makes
-- school_id nullable again.
--
-- READ THIS BEFORE RUNNING IT. Reversing costs more than it restores:
--
--   * It reinstates ~2.1 ms per candidate row on every read of all six
--     tables, for every role. question_attempts alone goes back to ~11 s at
--     4,809 rows, which is past the 8 s statement timeout — an HTTP 500.
--   * It reinstates the `school_id IS NULL` arm, under which any NULL-school
--     practice row is visible to every tenant and to anon.
--
-- Making school_id nullable again cannot lose data, and no NULL-school rows
-- existed when the forward migration ran. So this is safe to run; it is simply
-- a return to a slower and less safe state, and should only be a step on the
-- way to a corrected forward migration.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $down$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['student_mistakes','concept_mastery','practice_sessions',
                           'question_attempts','student_question_history','revision_queue'] LOOP
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN school_id DROP NOT NULL', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_tenant_fence', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR ALL TO anon, authenticated
         USING      ((school_id IS NULL) OR public.same_school(school_id))
         WITH CHECK ((school_id IS NULL) OR public.same_school(school_id))',
      t || '_tenant_fence', t);
  END LOOP;
END
$down$;

COMMIT;
