-- Rollback of 20261164000000_previous_year_questions_name_their_paper.sql
--
-- The previous-year questions themselves stay: they are bank rows students may
-- have answered, marked or reported. They lose the source_type the old rule
-- does not know (it becomes NULL, "not said"); exam_year and the source label
-- are left as they are, so the Previous Year Questions screen still finds them.

BEGIN;

SET LOCAL lock_timeout = '3s';

ALTER TABLE public.question_bank DROP CONSTRAINT question_bank_previous_year_names_its_paper;

UPDATE public.question_bank SET source_type = NULL WHERE source_type = 'previous_year';

ALTER TABLE public.question_bank DROP CONSTRAINT question_bank_source_type_check;
ALTER TABLE public.question_bank ADD CONSTRAINT question_bank_source_type_check
  CHECK (source_type IS NULL OR source_type = ANY (ARRAY[
    'ncert_aligned', 'ncert_exemplar_aligned', 'teacher', 'ai_generated',
    'licensed_import', 'legacy'
  ]::text[])) NOT VALID;
ALTER TABLE public.question_bank VALIDATE CONSTRAINT question_bank_source_type_check;

COMMIT;
