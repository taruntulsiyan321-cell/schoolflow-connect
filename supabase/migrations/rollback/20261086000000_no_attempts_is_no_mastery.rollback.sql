-- ROLLBACK 20261086000000 — concepts with no attempts read 56.8 again.
UPDATE public.concept_mastery SET mastery_score = 56.8 WHERE total_attempts = 0 AND mistake_count = 0;
DELETE FROM public.schema_migrations WHERE version = '20261086000000_no_attempts_is_no_mastery';
