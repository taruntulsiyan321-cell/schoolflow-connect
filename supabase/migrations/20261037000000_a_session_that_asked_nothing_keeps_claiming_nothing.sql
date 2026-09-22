-- A SESSION THAT ASKED NOTHING KEEPS CLAIMING NOTHING.
--
-- ── WHY THIS EXISTS WHEN 20261029000000 ALREADY "FIXED" THIS ────────────────
--
-- 20261029000000 recomputed every finished session's summary from its own
-- attempts and set question_count = 0 for the shells. It was a backfill. It
-- did not touch the function that MAKES them, so the check it was written to
-- satisfy went red again eight days later:
--
--     session summary = its own attempts         FAIL (6)
--     no session claims questions it never asked FAIL (6)
--
-- The six are from a practice-mode sweep on 2026-09-16: four `bookmarked` and
-- two `pyq` sessions, each finished one second after it was created, each
-- carrying question_count = 20 and zero attempts. Those two modes have no
-- content for this student — `practice_bookmarks` is empty school-wide and no
-- bank question carries a PYQ tag — so the loader returned nothing and the
-- session was auto-finished, exactly as designed.
--
-- What is not designed is what the finish then stored:
--
--     question_count = CASE WHEN _total > 0 THEN _total ELSE ps.question_count END
--
-- `ps.question_count` is the count that was ASKED FOR when the session was
-- created. So a session that showed the student nothing records itself as a
-- full twenty-question session, scored zero. Analysis, the trend line and the
-- streak all have to know to disbelieve it, and each of them has been fixed
-- separately for doing so.
--
-- ── THE FIX ─────────────────────────────────────────────────────────────────
--
--     question_count = _total
--
-- unconditionally. `_total` is the attempt count this function has just
-- counted from question_attempts; it is what the session actually asked. The
-- conditional had no case it served: re-finishing an already-finished session
-- recounts the same persisted attempts, and every sibling column
-- (correct_count, wrong_count, skipped_count, score) is already written
-- unconditionally from the same count, so this removes an exception rather
-- than adding a rule.
--
-- The six existing rows are corrected with the same formula 20261029000000
-- used — but this time the thing that made them is corrected first, so the
-- backfill is a cleanup rather than a treadmill.
--
-- Live bodies on this database are stored with CRLF; normalised first.

BEGIN;

DO $$
DECLARE
  _def text;
  _new text;
  _old text := 'question_count = CASE WHEN _total > 0 THEN _total ELSE ps.question_count END,';
  _new_expr text := 'question_count = _total,';
BEGIN
  SELECT replace(pg_get_functiondef(p.oid), E'\r\n', E'\n') INTO _def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'rpc_finish_practice_session';

  IF _def IS NULL THEN
    RAISE EXCEPTION 'rpc_finish_practice_session is not defined on this database';
  END IF;
  IF position(_old IN _def) = 0 THEN
    RAISE EXCEPTION 'would have failed open: the conditional question_count was not found verbatim in the live body';
  END IF;

  _new := replace(_def, _old, _new_expr);
  EXECUTE _new;
  RAISE NOTICE 'the finish now records the questions the session actually asked';
END $$;

-- POSITIVE CONTROL on the text: the conditional must be gone.
DO $$
DECLARE _def text;
BEGIN
  SELECT replace(pg_get_functiondef(p.oid), E'\r\n', E'\n') INTO _def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'rpc_finish_practice_session';
  IF position('ELSE ps.question_count' IN _def) > 0 THEN
    RAISE EXCEPTION 'would have failed open: the live body still falls back to the requested count';
  END IF;
END $$;

-- The rows the old body left behind.
UPDATE public.practice_sessions ps
   SET question_count = 0
 WHERE ps.finished_at IS NOT NULL
   AND ps.question_count <> 0
   AND NOT EXISTS (SELECT 1 FROM public.question_attempts qa WHERE qa.session_id = ps.id);

DO $$
DECLARE _n int;
BEGIN
  SELECT count(*) INTO _n
  FROM public.practice_sessions ps
  WHERE ps.finished_at IS NOT NULL AND ps.question_count > 0
    AND NOT EXISTS (SELECT 1 FROM public.question_attempts qa WHERE qa.session_id = ps.id);
  IF _n > 0 THEN
    RAISE EXCEPTION 'would have failed open: % shell session(s) still claim questions', _n;
  END IF;

  SELECT count(*) INTO _n
  FROM public.practice_sessions ps
  JOIN LATERAL (
    SELECT count(*)::int AS attempts,
           count(*) FILTER (WHERE qa.is_correct AND NOT COALESCE(qa.skipped, false))::int AS correct,
           count(*) FILTER (WHERE COALESCE(qa.skipped, false))::int AS skipped
    FROM public.question_attempts qa WHERE qa.session_id = ps.id
  ) a ON true
  WHERE ps.finished_at IS NOT NULL
    AND (ps.question_count <> a.attempts OR ps.correct_count <> a.correct OR ps.skipped_count <> a.skipped);
  IF _n > 0 THEN
    RAISE EXCEPTION 'would have failed open: % finished session(s) disagree with their attempts', _n;
  END IF;

  RAISE NOTICE 'every finished session agrees with its own attempts, and the finish will keep it that way';
END $$;

COMMIT;
