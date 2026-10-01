-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK: the charts RPC, the snapshot's heatmap and solution_viewed again
--
-- Re-adds question_attempts.solution_viewed (NOT NULL DEFAULT false, its
-- 20261132000000 description, and true on exactly the rows that had it), then
-- restores the six functions from what 20261135000000 saved — the charts RPC
-- with its grants (authenticated and service_role, never PUBLIC or anon).
-- Note what you are restoring: a write-only column, a heatmap and an RPC that
-- the app does not read (KNOWN_ISSUES 108). The column comes back at the end
-- of the table; nothing reads columns by position.
--
-- Undoes: 20261135000000_what_only_the_old_app_used_is_gone.sql
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE public.question_attempts ADD COLUMN solution_viewed boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.question_attempts.solution_viewed IS
  'True when the server returned an explanation with this question. The explanation is shown after every answer unasked, so this is NOT a record that the student chose to view a solution (20261132000000).';
UPDATE public.question_attempts qa SET solution_viewed = true
  FROM public.question_attempts_solution_viewed_pre_20261135000000 s
 WHERE s.id = qa.id;

DO $restore$
DECLARE r record; _n int := 0;
BEGIN
  FOR r IN SELECT definition FROM public.routines_pre_20261135000000 LOOP
    EXECUTE r.definition;
    _n := _n + 1;
  END LOOP;
  IF _n <> 6 THEN RAISE EXCEPTION 'expected six saved functions, restored %', _n; END IF;
END
$restore$;

-- Cleared, then granted one role at a time so the ACL reads exactly as it did:
-- {postgres, authenticated, service_role}.
REVOKE ALL ON FUNCTION public.rpc_student_performance_charts() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_student_performance_charts() TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_student_performance_charts() TO service_role;

DROP TABLE public.routines_pre_20261135000000;
DROP TABLE public.question_attempts_solution_viewed_pre_20261135000000;

NOTIFY pgrst, 'reload schema';

DELETE FROM public.schema_migrations WHERE version = '20261135000000_what_only_the_old_app_used_is_gone';

COMMIT;
