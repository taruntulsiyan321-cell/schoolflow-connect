-- ROLLBACK 20261047000000 — returns rpc_record_question_attempt to `RETURNS
-- uuid`.
--
-- READ THIS FIRST. The forward migration is what lets the client stop
-- holding the answer before the student has answered: the verdict and the
-- correct option come back from the server when the attempt is recorded.
-- Roll this back and any client that has been switched over loses its
-- feedback screen — it will have no way to tell the student whether they
-- were right.
--
-- So roll the CLIENT back with it, and do not roll this back while
-- 20261048000000 (which withdraws the student's read of question_bank) is
-- applied: the student would then have neither the answer nor the verdict.
--
-- Regenerating the old body faithfully means taking the current definition
-- and reversing exactly the two edits the forward migration made — the
-- return type and the three RETURN statements — which is what this does.

DO $rollback$
DECLARE
  _src text := pg_get_functiondef(
    'public.rpc_record_question_attempt(jsonb,jsonb,boolean,jsonb,uuid,numeric,boolean,uuid,integer,uuid,boolean,text,jsonb)'::regprocedure);
  _old text;
BEGIN
  _old := replace(_src, 'RETURNS jsonb', 'RETURNS uuid');
  _old := replace(_old, 'RETURN public._attempt_verdict(_aid);', 'RETURN _aid;');
  IF _old = _src THEN
    RAISE EXCEPTION 'nothing to reverse — is the forward migration applied?';
  END IF;
  IF _old LIKE '%_attempt_verdict%' THEN
    RAISE EXCEPTION 'a reference to the verdict helper survived the reversal';
  END IF;
  EXECUTE 'DROP FUNCTION IF EXISTS public.rpc_record_question_attempt(jsonb,jsonb,boolean,jsonb,uuid,numeric,boolean,uuid,integer,uuid,boolean,text,jsonb)';
  EXECUTE _old;
  EXECUTE 'REVOKE ALL ON FUNCTION public.rpc_record_question_attempt(jsonb,jsonb,boolean,jsonb,uuid,numeric,boolean,uuid,integer,uuid,boolean,text,jsonb) FROM anon';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.rpc_record_question_attempt(jsonb,jsonb,boolean,jsonb,uuid,numeric,boolean,uuid,integer,uuid,boolean,text,jsonb) TO authenticated';
END
$rollback$;

DROP FUNCTION IF EXISTS public._attempt_verdict(uuid);

DELETE FROM public.schema_migrations
 WHERE version = '20261047000000_the_server_tells_the_client_whether_it_was_right';

NOTIFY pgrst, 'reload schema';
