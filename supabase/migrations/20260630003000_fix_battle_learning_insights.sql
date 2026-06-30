-- Repair battle learning insights.
-- Concept analysis RPCs expect these optional columns on battle_questions.
-- Existing rows safely fall back to battle topic/chapter/subject when values are null.

ALTER TABLE public.battle_questions
  ADD COLUMN IF NOT EXISTS concept text,
  ADD COLUMN IF NOT EXISTS subconcept text;

UPDATE public.battle_questions bq
SET
  concept = COALESCE(bq.concept, qb.concept, qb.topic),
  subconcept = COALESCE(bq.subconcept, qb.subconcept)
FROM public.question_bank qb
WHERE bq.bank_question_id = qb.id
  AND (bq.concept IS NULL OR bq.subconcept IS NULL);
