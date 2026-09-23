-- ROLLBACK 20261055000000 — the school's stream applies to every class again.
--
-- Class 9/10 featured battles are again limited to the stream's subject list,
-- and new Class 9/10 sessions and answers are again labelled with the
-- school's stream. The cleared labels are re-derived from schools.stream,
-- which is where every one of them came from.
DO $mig$
DECLARE _def text;
BEGIN
  SELECT replace(pg_get_functiondef('public._pick_featured_subject(uuid,integer)'::regprocedure), E'\r\n', E'\n') INTO _def;
  EXECUTE replace(_def, E'\n  _stream := public._stream_for_class(_stream, _grade);\n', '');
  SELECT replace(pg_get_functiondef(p.oid), E'\r\n', E'\n') INTO _def
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND p.proname = 'rpc_start_practice_session';
  EXECUTE replace(_def, E'\n\n  _stream := public._stream_for_class(_stream, _class);', '');
END
$mig$;
DROP FUNCTION IF EXISTS public._stream_for_class(text, int);
UPDATE public.practice_sessions ps SET stream = s.stream
  FROM public.schools s
 WHERE s.id = ps.school_id AND ps.class_level < 11 AND ps.stream IS NULL AND s.stream IS NOT NULL;
UPDATE public.question_attempts qa SET stream = ps.stream
  FROM public.practice_sessions ps
 WHERE ps.id = qa.session_id AND qa.class_level < 11 AND qa.stream IS NULL AND ps.stream IS NOT NULL;
DELETE FROM public.schema_migrations WHERE version = '20261055000000_class_nine_and_ten_have_no_stream';
