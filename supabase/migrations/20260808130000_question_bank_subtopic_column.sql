-- Question bank: add subtopic granularity below the existing topic column.
-- Part of deepening the RBSE Class 11/12 Commerce question bank with real
-- topic/subtopic taxonomy instead of flat chapter-only classification.

ALTER TABLE public.question_bank
  ADD COLUMN IF NOT EXISTS subtopic text;

CREATE INDEX IF NOT EXISTS idx_qb_topic_subtopic
  ON public.question_bank (subject, chapter, topic)
  WHERE is_approved;

NOTIFY pgrst, 'reload schema';
