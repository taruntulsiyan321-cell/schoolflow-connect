-- ROLLBACK 20261095000000 — the variants' options as stored before, lettered.
BEGIN;

UPDATE public.question_bank q SET options = v.old_options, updated_at = now()
  FROM public.variant_option_letters_20261095 v WHERE q.id = v.question_id;

DROP TABLE public.variant_option_letters_20261095;

DELETE FROM public.schema_migrations WHERE version = '20261095000000_recovery_variants_are_stored_without_option_letters';

COMMIT;
