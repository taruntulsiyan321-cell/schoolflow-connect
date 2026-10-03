-- Rolls back 20261144000000_the_paper_is_read_by_the_analysis.sql.
-- The function reads no table and writes nothing, so dropping it is the whole
-- of the undo.
BEGIN;
DROP FUNCTION IF EXISTS public.rpc_exam_paper();
COMMIT;
