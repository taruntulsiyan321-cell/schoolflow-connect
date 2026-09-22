-- THE ROLL-UP FOLLOWS THE ATTEMPTS THAT REMAIN.
--
-- ── A GAP IN 20261032000000, CAUGHT BY A CHECK WRITTEN THE SAME DAY ─────────
--
-- 20261032000000 withdrew four unanswerable generated variants and deleted the
-- five attempts made on them. It then re-synced the affected sessions'
-- correct_count, wrong_count, skipped_count, question_count, score and
-- accuracy — every summary column except one.
--
-- It did not re-sync total_time_ms, so four sessions were left claiming time
-- for questions that no longer exist:
--
--     session    total_time_ms   sum of remaining attempts
--     edc28dea          17,936                      13,618
--     c3a8b85d          17,022                      16,307
--     f700969f          10,380                       9,699
--     b9abd7b8           8,367                       7,713
--
-- That is the same defect 20261030000000 exists to prevent — a session's
-- duration disagreeing with its own questions — reintroduced by a migration
-- written to fix something else. It is exactly what "deleting something to fix
-- A shall not break B" means, and the only reason it was found within the hour
-- is that check 13 of LOOP_END_TO_END_VERIFY went in beside it.
--
-- ── WHAT THIS DOES ──────────────────────────────────────────────────────────
--
-- Re-derives total_time_ms from the surviving attempts wherever the two
-- disagree, which is the rule rpc_finish_practice_session already applies
-- (`total_time_ms = NULLIF(_time_ms, 0)`, summed from question_attempts). No
-- new definition; the existing one, applied to rows whose attempts moved
-- underneath them.

BEGIN;

WITH per_session AS (
  SELECT session_id, SUM(time_taken_ms)::bigint AS ms
  FROM public.question_attempts
  WHERE session_id IS NOT NULL AND COALESCE(time_taken_ms, 0) > 0
  GROUP BY session_id
)
UPDATE public.practice_sessions ps
SET total_time_ms = per_session.ms
FROM per_session
WHERE per_session.session_id = ps.id
  AND ps.total_time_ms IS DISTINCT FROM per_session.ms;

-- A session whose every timed attempt is gone has no duration left to report.
UPDATE public.practice_sessions ps
SET total_time_ms = NULL
WHERE ps.total_time_ms IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.question_attempts qa
     WHERE qa.session_id = ps.id AND COALESCE(qa.time_taken_ms, 0) > 0);

DO $$
DECLARE _n int;
BEGIN
  SELECT count(*) INTO _n
  FROM public.practice_sessions ps
  JOIN LATERAL (
    SELECT sum(qa.time_taken_ms)::bigint AS ms
    FROM public.question_attempts qa
    WHERE qa.session_id = ps.id AND COALESCE(qa.time_taken_ms, 0) > 0
  ) t ON true
  WHERE t.ms > 0 AND ps.total_time_ms IS DISTINCT FROM t.ms;
  IF _n > 0 THEN
    RAISE EXCEPTION 'would have failed open: % session(s) still disagree with their own timings', _n;
  END IF;

  SELECT count(*) INTO _n
  FROM public.practice_sessions ps
  WHERE ps.total_time_ms IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.question_attempts qa
                     WHERE qa.session_id = ps.id AND COALESCE(qa.time_taken_ms, 0) > 0);
  IF _n > 0 THEN
    RAISE EXCEPTION 'would have failed open: % session(s) report time with no timed attempt behind it', _n;
  END IF;

  RAISE NOTICE 'every session''s duration is the sum of the attempts it still has';
END $$;

COMMIT;
