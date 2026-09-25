-- ROLLBACK 20261083000000 — exam-account sessions (and their attempts) are
-- labelled 'rbse' again, and new ones default to it.
DO $mig$
DECLARE _def text; _n int;
  _new CONSTANT text := $x$lower(COALESCE(board,
               (SELECT ce.code FROM public.exam_accounts ea
                  JOIN public.competitive_exams ce ON ce.id = ea.exam_id
                 WHERE ea.school_id = _school),
               'rbse'))$x$;
BEGIN
  SELECT replace(pg_get_functiondef('public.rpc_start_practice_session'::regproc), E'\r\n', E'\n') INTO _def;
  _n := (length(_def) - length(replace(_def, _new, ''))) / length(_new);
  IF _n <> 2 THEN RAISE EXCEPTION 'does not carry 20261083000000 (% matches)', _n; END IF;
  EXECUTE replace(_def, _new, $x$lower(COALESCE(board, 'rbse'))$x$);
END
$mig$;
UPDATE public.practice_sessions ps SET board = 'rbse' FROM public.exam_accounts ea WHERE ps.school_id = ea.school_id;
UPDATE public.question_attempts qa SET board = 'rbse' FROM public.exam_accounts ea WHERE qa.school_id = ea.school_id;
DELETE FROM public.schema_migrations WHERE version = '20261083000000_an_exam_account_practises_under_its_exam';
