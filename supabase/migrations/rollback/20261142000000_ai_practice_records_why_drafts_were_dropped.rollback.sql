-- Rollback for 20261142000000: no record of what became of AI Practice's
-- drafts (what is recorded is LOST).
BEGIN;

ALTER TABLE public.ai_practice_requests DROP COLUMN drafts;

COMMIT;
