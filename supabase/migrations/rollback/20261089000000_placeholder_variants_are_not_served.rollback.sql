-- ROLLBACK 20261089000000 — the 11 placeholder rows are served again.
BEGIN;

UPDATE public.question_bank q SET is_active = true, updated_at = now()
  FROM public.placeholder_variants_20261089 p WHERE q.id = p.question_id;

DROP TABLE public.placeholder_variants_20261089;

DELETE FROM public.schema_migrations WHERE version = '20261089000000_placeholder_variants_are_not_served';

COMMIT;
