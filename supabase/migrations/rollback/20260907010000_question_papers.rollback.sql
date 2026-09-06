-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK — the question paper tables go away
--
-- DESTRUCTIVE: this drops the papers themselves, not just the schema. Every
-- blueprint and every assembled question is deleted, and the generated
-- questions written back to `question_bank` are NOT removed with them — they
-- are ordinary bank rows owned by their author and outlive the paper by design.
--
-- Ordered child-first so the FKs do not block, though CASCADE would cover it.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;

DROP TABLE IF EXISTS public.question_paper_questions CASCADE;
DROP TABLE IF EXISTS public.question_paper_sections  CASCADE;
DROP TABLE IF EXISTS public.question_papers          CASCADE;

COMMIT;
