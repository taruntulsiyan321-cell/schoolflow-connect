-- AN EXAM ACCOUNT PRACTISES UNDER ITS EXAM, NOT UNDER RBSE.
--
-- rpc_start_practice_session labels every session with the school's board,
-- `lower(COALESCE(board, 'rbse'))`. An individual exam account's space has no
-- board by design (20261046000000: "the question bank is chosen by exam"),
-- so every CUET session was stored as board 'rbse', and
-- rpc_record_question_attempt copies the session's board onto each attempt.
-- Measured 2026-09-24: 27 CUET sessions and 50 CUET attempts labelled 'rbse'.
-- The client already refuses to do this ("Individual: exam is the scope.
-- Never invent rbse"); the server now agrees.
--
-- An exam account's sessions carry its exam's code — 'cuet', the same board
-- value its questions carry. A school with no board keeps the old default.
-- Existing rows are relabelled the same way.
DO $mig$
DECLARE _def text; _n int;
  _old CONSTANT text := $x$lower(COALESCE(board, 'rbse'))$x$;
  _new CONSTANT text := $x$lower(COALESCE(board,
               (SELECT ce.code FROM public.exam_accounts ea
                  JOIN public.competitive_exams ce ON ce.id = ea.exam_id
                 WHERE ea.school_id = _school),
               'rbse'))$x$;
BEGIN
  SELECT replace(pg_get_functiondef('public.rpc_start_practice_session'::regproc), E'\r\n', E'\n') INTO _def;
  _n := (length(_def) - length(replace(_def, _old, ''))) / length(_old);
  IF _n <> 2 THEN RAISE EXCEPTION 'rpc_start_practice_session board default matched % times (2 expected)', _n; END IF;
  EXECUTE replace(_def, _old, _new);
END
$mig$;

UPDATE public.practice_sessions ps SET board = ce.code
  FROM public.exam_accounts ea JOIN public.competitive_exams ce ON ce.id = ea.exam_id
 WHERE ps.school_id = ea.school_id AND ps.board IS DISTINCT FROM ce.code;

UPDATE public.question_attempts qa SET board = ce.code
  FROM public.exam_accounts ea JOIN public.competitive_exams ce ON ce.id = ea.exam_id
 WHERE qa.school_id = ea.school_id AND qa.board IS DISTINCT FROM ce.code;

DO $proof$
DECLARE _bad int;
BEGIN
  SELECT count(*) INTO _bad FROM public.practice_sessions ps
    JOIN public.exam_accounts ea ON ea.school_id = ps.school_id
    JOIN public.competitive_exams ce ON ce.id = ea.exam_id
   WHERE ps.board IS DISTINCT FROM ce.code;
  IF _bad <> 0 THEN RAISE EXCEPTION '% exam-account sessions still carry another board', _bad; END IF;
  IF position('exam_accounts' IN pg_get_functiondef('public.rpc_start_practice_session'::regproc)) = 0 THEN
    RAISE EXCEPTION 'rpc_start_practice_session does not read the exam';
  END IF;
END
$proof$;
