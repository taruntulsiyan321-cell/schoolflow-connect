-- Rolls back 20261146000000_a_student_is_read_against_others_on_shared_questions.sql.
-- The function reads and writes nothing of its own, so dropping it is the whole undo.
BEGIN;
DROP FUNCTION IF EXISTS public.rpc_student_peer_comparison();
COMMIT;
