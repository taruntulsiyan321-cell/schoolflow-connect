-- Rollback for 20261141000000: no form classifier or trigger; every new form back
-- to 'mcq' (on 2026-10-03, before this migration, every row was 'mcq'); the old
-- format list; ai_practice_bank_candidates without a form; no form on
-- ai_practice_requests (the form each request asked for is LOST).
--
-- DATA IS NOT UNDONE: the imported '(e) …' tail cut from option D stays cut,
-- and the one assertion–reason question set 'disputed' (its key may be (e))
-- stays disputed with its note.
BEGIN;

DROP TRIGGER trg_question_bank_form ON public.question_bank;
DROP FUNCTION public._question_bank_form();

UPDATE public.question_bank SET question_format = 'mcq'
 WHERE question_format IN ('assertion_reason', 'statements', 'match', 'case_based', 'sequence');
DROP FUNCTION public.question_form_of(text, jsonb);

ALTER TABLE public.question_bank DROP CONSTRAINT question_bank_question_format_check;
ALTER TABLE public.question_bank
  ADD CONSTRAINT question_bank_question_format_check
  CHECK (((question_format IS NULL) OR (question_format = ANY (ARRAY['mcq'::text, 'short'::text, 'long'::text, 'numerical'::text, 'assertion_reason'::text, 'case_based'::text, 'concept'::text]))));

ALTER TABLE public.ai_practice_requests DROP COLUMN form;

DROP FUNCTION public.ai_practice_bank_candidates(uuid, uuid, uuid, uuid, text, text, vector, integer);

CREATE FUNCTION public.ai_practice_bank_candidates(
  _user uuid, _exam uuid, _chapter uuid, _topic uuid, _difficulty text, _query vector, _limit integer)
RETURNS TABLE (id uuid, similarity double precision, topic_id uuid, difficulty text)
LANGUAGE sql
STABLE
SET search_path = public
AS $fn$
  SELECT qb.id,
         CASE WHEN _query IS NULL OR qb.embedding IS NULL THEN NULL
              ELSE 1 - (qb.embedding <=> _query) END,
         qb.topic_id,
         qb.difficulty
    FROM public.question_bank qb
   WHERE qb.exam_id = _exam
     AND qb.chapter_id = _chapter
     AND (_topic IS NULL OR qb.topic_id = _topic)
     AND (_difficulty IS NULL OR qb.difficulty = _difficulty)
     AND qb.is_active AND qb.is_approved
     AND qb.replaced_by_question_id IS NULL
     AND qb.variant_tier IS NULL
     AND qb.correct_index IS NOT NULL
     AND jsonb_typeof(qb.options) = 'array'
     AND NOT EXISTS (
       SELECT 1 FROM public.question_attempts qa
        WHERE qa.user_id = _user AND qa.bank_question_id = qb.id
          AND qa.created_at > now() - interval '30 days')
   ORDER BY CASE WHEN _query IS NULL OR qb.embedding IS NULL THEN 1 ELSE 0 END,
            qb.embedding <=> _query,
            md5(qb.id::text || current_date::text)
   LIMIT greatest(1, least(_limit, 200));
$fn$;

REVOKE ALL ON FUNCTION public.ai_practice_bank_candidates(uuid, uuid, uuid, uuid, text, vector, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ai_practice_bank_candidates(uuid, uuid, uuid, uuid, text, vector, integer) TO service_role;

COMMIT;
