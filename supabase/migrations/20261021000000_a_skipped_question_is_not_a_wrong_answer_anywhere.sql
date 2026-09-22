-- ════════════════════════════════════════════════════════════════════════════
-- A SKIPPED QUESTION IS NOT A WRONG ANSWER — ANYWHERE
-- ════════════════════════════════════════════════════════════════════════════
--
-- THE HALF-FIX THIS FINISHES
--
-- c47b70a ("Skipped questions are not wrong answers, and Analysis now says
-- so") changed how Analysis computes accuracy: correct / (correct + wrong),
-- with skips excluded and shown in their own tile. It did not change where the
-- number is DECIDED, so the product has carried two definitions since.
--
-- Measured live, one session by one student, 2026-09-15:
--
--   6 questions, 2 correct, 3 wrong, 1 skipped
--     practice_sessions.accuracy  33.33%   (2 / 6 — the skip counted as wrong)
--     Analysis                    40%      (2 / 5 — the skip excluded)
--
-- Same sitting, two screens, two numbers. That is the defect RULE 0 names
-- exactly: a correction applied at one consumer instead of at the definition,
-- leaving two homes for one decision.
--
-- THE FIX, AT THE DEFINITION
--
--   accuracy = correct / (correct + wrong)
--
-- and NULL — not 0 — when nothing was answered. A rate over zero questions is
-- not zero, it is absent; rpc_submit_recovery_session already says so in those
-- words, and `ELSE 0` here made a session where the student skipped everything
-- read as a hard 0%, which is a claim about them rather than about the data.
--
-- The existing rows are rewritten to the same rule. A stored number computed
-- one way and a screen computing it another is how this started, so leaving
-- history on the old rule would leave the contradiction in place where it is
-- hardest to see.
--
-- xp is deliberately untouched: XP is correct × 5, which never used the
-- denominator and is not a rate.
--
-- ROLLBACK: supabase/migrations/rollback/20261021000000_down.sql
-- ════════════════════════════════════════════════════════════════════════════

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
  IF position(E'\r' IN _def) > 0 THEN
    RAISE EXCEPTION 'a carriage return survived normalisation';
  END IF;

  _new := replace(_def,
    'accuracy = CASE WHEN _total > 0 THEN round((_correct::numeric / _total) * 100, 2) ELSE 0 END',
    'accuracy = CASE WHEN (_correct + _wrong) > 0
                     THEN round((_correct::numeric / (_correct + _wrong)) * 100, 2) END');

  IF _new = _def THEN
    RAISE EXCEPTION 'the accuracy anchor matched nothing — the substitution would have failed open';
  END IF;

  EXECUTE _new;
END $rewrite$;

-- The rewrite must actually be in the live body, and the old form must be gone.
DO $check$
DECLARE _def text;
BEGIN
  SELECT replace(pg_get_functiondef(p.oid), E'\r\n', E'\n') INTO _def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'rpc_finish_practice_session';

  IF position('_correct::numeric / _total' IN _def) > 0 THEN
    RAISE EXCEPTION 'the old denominator survives in the live body';
  END IF;
  IF position('(_correct + _wrong)' IN _def) = 0 THEN
    RAISE EXCEPTION 'the new denominator is not in the live body';
  END IF;
END $check$;

-- ── The rows already written ────────────────────────────────────────────────
-- wrong_count is not trusted as the denominator here: it has been written by
-- more than one version of the finisher. The attempts are the record, so the
-- counts come from them, and a session with no attempt rows is left alone
-- rather than being rewritten from a count of nothing.
WITH counted AS (
  SELECT qa.session_id,
         count(*) FILTER (WHERE qa.is_correct AND NOT COALESCE(qa.skipped, false))::int AS correct,
         count(*) FILTER (WHERE NOT COALESCE(qa.skipped, false))::int                   AS answered
  FROM public.question_attempts qa
  GROUP BY qa.session_id
)
UPDATE public.practice_sessions ps
   SET accuracy = CASE WHEN c.answered > 0
                       THEN round((c.correct::numeric / c.answered) * 100, 2) END
  FROM counted c
 WHERE c.session_id = ps.id
   AND ps.accuracy IS DISTINCT FROM
       CASE WHEN c.answered > 0
            THEN round((c.correct::numeric / c.answered) * 100, 2) END;

COMMIT;
