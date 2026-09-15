-- Rollback for 20261021000000_a_skipped_question_is_not_a_wrong_answer_anywhere.sql
--
-- Restores accuracy = correct / question_count, with 0 for an empty session,
-- and rewrites the stored rows back to that rule.
--
-- What this re-introduces, stated plainly because it is not a neutral undo:
--   * A skipped question counts as a wrong answer again, so the SAME sitting
--     reads 33.33% here and 40% on Analysis, which computes it the other way.
--     Measured: 6 questions, 2 correct, 3 wrong, 1 skipped.
--   * A session in which nothing was answered reports a hard 0% instead of
--     "no rate", which is a claim about the student rather than about the data.

BEGIN;

DO $rewrite$
DECLARE _def text; _new text;
BEGIN
  SELECT replace(pg_get_functiondef(p.oid), E'\r\n', E'\n') INTO _def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.prokind = 'f'
     AND p.proname = 'rpc_finish_practice_session';

  IF _def IS NULL THEN
    RAISE EXCEPTION 'rpc_finish_practice_session not found';
  END IF;

  _new := replace(_def,
    'accuracy = CASE WHEN (_correct + _wrong) > 0
                     THEN round((_correct::numeric / (_correct + _wrong)) * 100, 2) END',
    'accuracy = CASE WHEN _total > 0 THEN round((_correct::numeric / _total) * 100, 2) ELSE 0 END');

  IF _new = _def THEN
    RAISE EXCEPTION 'the accuracy anchor matched nothing — the substitution would have failed open';
  END IF;

  EXECUTE _new;
END $rewrite$;

WITH counted AS (
  SELECT qa.session_id,
         count(*) FILTER (WHERE qa.is_correct AND NOT COALESCE(qa.skipped, false))::int AS correct,
         count(*)::int                                                                  AS total
  FROM public.question_attempts qa
  GROUP BY qa.session_id
)
UPDATE public.practice_sessions ps
   SET accuracy = CASE WHEN c.total > 0
                       THEN round((c.correct::numeric / c.total) * 100, 2) ELSE 0 END
  FROM counted c
 WHERE c.session_id = ps.id;

COMMIT;
