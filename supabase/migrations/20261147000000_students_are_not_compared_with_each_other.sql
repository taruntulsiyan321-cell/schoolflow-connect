-- ═══════════════════════════════════════════════════════════════════════════
-- STUDENTS ARE NOT COMPARED WITH EACH OTHER
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Owner ruling, 2026-10-04: §6.7 of the analysis spec stands — "What analysis
-- must never do: compare the student to other students (leaderboards are
-- separate, §10.16)." 20261146000000 built rpc_student_peer_comparison from
-- an approved list that had not caught the rule; asked, the owner kept §6.7.
-- No client ever called it. This removes it, so the rule has no door left.
--
-- ROLLBACK: rollback/20261147000000_students_are_not_compared_with_each_other.rollback.sql
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DROP FUNCTION public.rpc_student_peer_comparison();

-- ── VERIFY ──────────────────────────────────────────────────────────────────
DO $verify$
BEGIN
  IF to_regprocedure('public.rpc_student_peer_comparison()') IS NOT NULL THEN
    RAISE EXCEPTION 'VERIFY FAILED: the peer comparison is still there';
  END IF;
END $verify$;

COMMIT;
