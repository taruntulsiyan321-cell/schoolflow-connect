-- ROLLBACK 20261081000000 — anyone holding the public anon key can read the
-- board-NULL and 'both' rows of question_bank_student again.
GRANT SELECT ON public.question_bank_student TO anon;
DELETE FROM public.schema_migrations WHERE version = '20261081000000_the_question_bank_view_needs_a_sign_in';
