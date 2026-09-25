-- Rollback: 20261064000000_match_question_bank_for_exam

BEGIN;

DROP FUNCTION IF EXISTS public.match_question_bank_for_exam(vector, uuid, text[], double precision, integer);

COMMIT;
