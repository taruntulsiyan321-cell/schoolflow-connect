-- ROLLBACK 20261057000000 — removes the chapter analysis and the shared
-- "still skipped" definition. The client's chapter list and skipped mode
-- then have nothing to read; roll the client back with it.
DROP FUNCTION IF EXISTS public.rpc_student_chapter_analysis();
DROP FUNCTION IF EXISTS public.rpc_my_skipped_questions(uuid, int);
DROP FUNCTION IF EXISTS public._still_skipped_questions(uuid);
DROP INDEX IF EXISTS public.question_attempts_user_bank_latest;
DELETE FROM public.schema_migrations WHERE version = '20261057000000_the_chapter_list_analysis_is_built_on';
