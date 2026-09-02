-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK — chunk 10.5, strength at the source
-- Undoes 20260901100000_chunk105_strength_at_the_source.sql — PARTIALLY.
--
-- ███ THIS IS A PARTIAL ROLLBACK. READ THIS BEFORE RUNNING IT. ███
--
-- It restores the three columns. It does NOT restore the four function bodies,
-- and no honest script can. What follows is why, because the reasoning is the
-- reason this file is not longer.
--
-- ── Why the bodies cannot be restored ─────────────────────────────────────
--
-- The forward migration rewrote four functions through pg_get_functiondef and
-- regexp_replace. Every one of its substitutions DELETES text:
--
--   regexp_replace(_def, '\s*''strong_topics'',\s*_strong,', '', 'g')
--   regexp_replace(_new, 'SELECT[^;]*?INTO _strong[a-z_]*[^;]*?;', '', 'gs')
--   ... and so on for all four functions
--
-- A text-for-text substitution has an inverse; a deletion does not. The deleted
-- text is not in the current body to match on, and no snapshot of the previous
-- bodies was taken before the rewrite. That is the actual defect here, and it
-- belongs to the forward migration, not to this file.
--
-- ── Why restoring from the last literal definition would be WORSE ─────────
--
-- The obvious repair — reinstate each body from the last migration that spelled
-- it out — is not merely imperfect, it is dangerous. Measured, per function,
-- counting migrations that touched it between its last literal definition and
-- this one:
--
--   rpc_refresh_academic_brain       18 intervening migrations
--   rpc_student_academic_snapshot     8
--   _build_concept_recovery_report    3
--   rpc_compute_session_analytics     2
--
-- Among those 18/8/3/2 are 20260828190000_dpp_privacy_leak_closure and
-- 20260822240000_gap_closure_admin_principal_cross_school_leaks. Restoring an
-- older body would silently REOPEN two closed leaks — a privacy leak and a
-- cross-school leak — while appearing to be a tidy revert. A rollback that
-- reintroduces a security fix's absence is strictly worse than no rollback, so
-- this file does not do it.
--
-- ── What a real revert of 10.5 would take ─────────────────────────────────
--
-- A forward migration that re-implements the strength emitters against the
-- CURRENT bodies — the same shape as the original change, written in reverse.
-- That is authored work, not a script, and it is the honest answer.
--
-- ── What this file therefore does, and why that is still worth having ─────
--
-- It restores the three columns to their exact prior definition. That is
-- genuinely reversible and genuinely useful in one situation: if something
-- outside this repo still SELECTs those columns — an edge function, a client
-- build not yet redeployed — re-adding them stops the error immediately while
-- the real fix is prepared.
--
-- The values do not come back, and this file does not pretend they do. They
-- were a derived cache: student_academic_brain is rebuilt by
-- rpc_refresh_academic_brain, and only 2 of 223 students hold a cached row at
-- all. Once emitters exist again, a refresh repopulates them. Until then the
-- columns sit at their default '[]', which is what an unrefreshed cache row
-- looks like — not an invented value.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- Exactly the definition the forward migration dropped, transcribed from the
-- CREATE TABLE that introduced them.
ALTER TABLE public.student_academic_brain
  ADD COLUMN IF NOT EXISTS strong_subjects jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS strong_chapters jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS strong_concepts jsonb NOT NULL DEFAULT '[]'::jsonb;

DO $verify$
DECLARE _n int; _emitters text;
BEGIN
  SELECT count(*) INTO _n
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'student_academic_brain'
     AND column_name IN ('strong_subjects', 'strong_chapters', 'strong_concepts');
  IF _n <> 3 THEN
    RAISE EXCEPTION 'rollback: % of 3 strength column(s) present after the restore.', _n;
  END IF;

  -- State the remaining gap as a fact about the database, not as a comment.
  -- G14: a control that lives only in prose is not a control. If some later
  -- work DOES restore the emitters, this notice stops firing on its own.
  SELECT string_agg(p.proname, ', ') INTO _emitters
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN ('rpc_student_academic_snapshot', 'rpc_compute_session_analytics',
                       '_build_concept_recovery_report', 'rpc_refresh_academic_brain')
     AND p.prosrc ~* 'strong_(subjects|chapters|concepts|topics)';

  IF _emitters IS NULL THEN
    RAISE NOTICE
      'PARTIAL ROLLBACK: the 3 columns are back and will stay empty. No function writes them — the emitters were deleted by 20260901100000 and cannot be restored by script. See this file''s header.';
  ELSE
    RAISE NOTICE 'columns restored; these already emit strength again: %', _emitters;
  END IF;
END
$verify$;

COMMIT;
