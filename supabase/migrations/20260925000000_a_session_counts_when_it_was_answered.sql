-- ═══════════════════════════════════════════════════════════════════════════
-- A session counts when it was answered
--
-- rpc_student_academic_snapshot reports self_practice.sessions_completed as:
--
--     SELECT count(*) FROM practice_sessions
--      WHERE user_id = _uid AND finished_at IS NOT NULL;
--
-- "Finished" is not "answered". A session the loader could not fill is
-- auto-finished — deliberately, so Resume is not polluted with shells — and
-- that stores finished_at with correct_count 0 and accuracy 0, while
-- question_count keeps the REQUESTED count because
-- rpc_finish_practice_session only overwrites it when the attempt total is
-- above zero.
--
-- Measured live, 2026-09-13:
--
--   the busiest student   16 sessions "completed", 14 of them 0-attempt shells
--   across all students   258 finished, 14 shells
--
-- So the Analysis "Practice sessions" tile read 16 for a student who had sat
-- two. The shells came from Weak Areas Practice returning no questions, which
-- is fixed separately (the weak filter now reaches the database). This is the
-- other half: the count has to stop treating an unanswered session as one.
--
-- ── THE SAME RULE, IN THE SAME WORDS, AS THE CLIENT ──────────────────────
--
-- src/hooks/useAnalysisPageData.ts exports `sessionWasAttempted` with exactly
-- this predicate, because Analysis filters its session LIST the same way. That
-- is one rule in two languages, not two rules: correct + wrong + skipped is
-- the attempt count, and question_count is not — question_count is precisely
-- what made a shell look like a full twenty-question session.
--
-- Reverse: supabase/migrations/rollback/20260925000000_a_session_counts_when_it_was_answered.rollback.sql
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $fix$
DECLARE _def text; _new text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO _def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'rpc_student_academic_snapshot';

  IF _def IS NULL THEN
    RAISE EXCEPTION 'rpc_student_academic_snapshot not found';
  END IF;

  IF _def LIKE '%skipped_count, 0)) > 0%' THEN
    RAISE NOTICE 'already counting attempted sessions only; nothing to do';
    RETURN;
  END IF;

  -- Anchored on the whole statement, not on the table name: practice_sessions
  -- is read more than once in this function and a looser match would narrow
  -- the wrong query.
  _new := replace(_def,
    'FROM public.practice_sessions WHERE user_id = _uid AND finished_at IS NOT NULL;',
    'FROM public.practice_sessions WHERE user_id = _uid AND finished_at IS NOT NULL'
      || E'\n    AND (COALESCE(correct_count, 0) + COALESCE(wrong_count, 0) + COALESCE(skipped_count, 0)) > 0;');

  IF _new = _def THEN
    RAISE EXCEPTION
      'could not find the sessions_completed query to narrow. The live body has changed shape — re-read it with pg_get_functiondef before editing.';
  END IF;

  EXECUTE _new;
  RAISE NOTICE 'sessions_completed now counts only sessions with an attempt.';
END
$fix$;

-- ── Prove it changed the number, for a real student ──────────────────────
-- G11: this can fail. It compares the old predicate against the new one over
-- the live table and requires the function to agree with the NEW one. A
-- substitution that silently did nothing leaves the function on the old count
-- and this raises.
DO $prove$
DECLARE
  _uid       uuid;
  _all       int;
  _attempted int;
  _reported  int;
BEGIN
  SELECT ps.user_id INTO _uid
    FROM public.practice_sessions ps
   WHERE ps.finished_at IS NOT NULL
   GROUP BY ps.user_id
   ORDER BY count(*) DESC
   LIMIT 1;

  IF _uid IS NULL THEN
    RAISE WARNING 'no finished practice session anywhere; the count could not be exercised';
    RETURN;
  END IF;

  SELECT count(*)::int INTO _all
    FROM public.practice_sessions
   WHERE user_id = _uid AND finished_at IS NOT NULL;

  SELECT count(*)::int INTO _attempted
    FROM public.practice_sessions
   WHERE user_id = _uid AND finished_at IS NOT NULL
     AND (COALESCE(correct_count, 0) + COALESCE(wrong_count, 0) + COALESCE(skipped_count, 0)) > 0;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', _uid)::text, true);
  _reported := ((public.rpc_student_academic_snapshot() -> 'self_practice') ->> 'sessions_completed')::int;

  IF _reported IS DISTINCT FROM _attempted THEN
    RAISE EXCEPTION
      'sessions_completed reports % but only % of this student''s % finished sessions were answered',
      _reported, _attempted, _all;
  END IF;

  RAISE NOTICE 'sessions_completed = % (was % before the shells were excluded).', _attempted, _all;
END
$prove$;

COMMIT;
