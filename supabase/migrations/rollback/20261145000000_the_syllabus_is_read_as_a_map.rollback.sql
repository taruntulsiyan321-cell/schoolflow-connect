-- Rolls back 20261145000000_the_syllabus_is_read_as_a_map.sql.
-- The function reads and writes nothing of its own, so dropping it is the whole undo.
BEGIN;
DROP FUNCTION IF EXISTS public.rpc_student_syllabus_map(integer);
COMMIT;
