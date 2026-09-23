-- ROLLBACK 20261053000000 — removes the §4.4 "clear anyway" door.
--
-- A student whose recovery session is scored not_ready is then stuck with
-- the chapter in_recovery until a session scores ready. Chapters already
-- cleared through it stay cleared; this does not reopen their mistakes.
DROP FUNCTION IF EXISTS public.rpc_clear_chapter_after_recovery(uuid);
DELETE FROM public.schema_migrations
 WHERE version = '20261053000000_a_student_may_clear_a_chapter_that_is_not_ready';
