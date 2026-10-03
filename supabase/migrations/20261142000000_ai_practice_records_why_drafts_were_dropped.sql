-- ═══════════════════════════════════════════════════════════════════════════
-- AI PRACTICE RECORDS WHY ITS DRAFTS WERE DROPPED
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Measured 2026-10-03, the first requests for a form: "4 match the following
-- questions" gave 1, "3 case-based questions" gave 2, and nothing said why —
-- a writing batch that is cut off or not JSON was not even counted as
-- discarded. ai_practice_requests.drafts now keeps, per request, what each
-- writing batch returned (asked, read, how it finished, why each draft was
-- refused) and how many drafts the independent check refused, so a short
-- session can be explained and the writer tuned from evidence.
--
-- The student reads their own row (the existing own-read policy); nothing in
-- it is anyone else's.
--
-- ROLLBACK: rollback/20261142000000_ai_practice_records_why_drafts_were_dropped.rollback.sql
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE public.ai_practice_requests ADD COLUMN drafts jsonb;

COMMENT ON COLUMN public.ai_practice_requests.drafts IS
  'What became of the drafts (20261142000000): {"batches":[{"asked","read","finish","refused":[reason…]}],"drafted","agreed","kept"}. NULL when nothing was written.';

-- ── VERIFY ──────────────────────────────────────────────────────────────────
DO $verify$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'ai_practice_requests' AND column_name = 'drafts' AND data_type = 'jsonb') THEN
    RAISE EXCEPTION 'VERIFY FAILED: ai_practice_requests.drafts is missing';
  END IF;
  IF has_table_privilege('authenticated', 'public.ai_practice_requests', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.ai_practice_requests', 'INSERT') THEN
    RAISE EXCEPTION 'VERIFY FAILED: a student can write the request log';
  END IF;
END $verify$;

COMMIT;
