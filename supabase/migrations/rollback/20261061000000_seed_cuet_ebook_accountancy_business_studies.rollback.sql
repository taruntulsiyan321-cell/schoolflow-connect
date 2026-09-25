-- ROLLBACK of 20261061000000_seed_cuet_ebook_accountancy_business_studies: the
-- PW ebook questions it inserted, removed.
--
-- Everything since stands on this seed — the bank repair (20261084000000,
-- 20261088000000, 20261099000000), the NTA chapter rebuild (20261090000000),
-- every attempt and mistake a CUET student made. Roll those back first. And it
-- REFUSES while any student has answered a seeded question: their history
-- cannot be taken back with the questions, and deleting under it would leave
-- attempts pointing at nothing. The curriculum rows the seed created (the CUET
-- board, class, subjects, chapters and topics) are left: it inserted them ON
-- CONFLICT DO NOTHING, so which ones it created is not recorded, and later
-- migrations build on them.

BEGIN;

DO $guard$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.question_attempts qa
      JOIN public.question_bank qb ON qb.id = qa.bank_question_id
     WHERE qb.source LIKE 'PW CUET ebook · %'
  ) OR EXISTS (
    SELECT 1 FROM public.student_mistakes sm
      JOIN public.question_bank qb ON qb.id = sm.question_id
     WHERE qb.source LIKE 'PW CUET ebook · %'
  ) THEN
    RAISE EXCEPTION 'students have answered the seeded questions — this seed cannot be taken back without their history';
  END IF;
END
$guard$;

DELETE FROM public.question_bank qb
 WHERE qb.source LIKE 'PW CUET ebook · %'
   AND qb.source_question_id IS NULL
   AND qb.source_upload_question_id IS NULL;

DELETE FROM public.schema_migrations WHERE version = '20261061000000_seed_cuet_ebook_accountancy_business_studies';

COMMIT;
