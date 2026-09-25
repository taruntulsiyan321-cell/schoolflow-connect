-- ROLLBACK 20261087000000 — drops rpc_my_skipped_by_chapter. The chapter list
-- then has no skip counts from the server. rpc_student_chapter_analysis is
-- restored by re-applying 20261058000000's definition (it dropped nothing
-- else, and nothing called it).
DROP FUNCTION IF EXISTS public.rpc_my_skipped_by_chapter();
DELETE FROM public.schema_migrations WHERE version = '20261087000000_analysis_counts_the_questions_you_still_skipped';
