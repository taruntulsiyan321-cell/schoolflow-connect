-- #8 — a school's stream was applied to every class in it.
--
-- Streams (science, commerce, arts) are chosen at Class 11. Wisdom Campus is
-- tagged 'commerce', and that tag was read as if it applied to Class 9 and 10:
--   * _pick_featured_subject offered a Class 9/10 class only the commerce
--     list, so their featured battle was always Mathematics — Science and
--     Social Science could never be featured;
--   * rpc_start_practice_session stored the school's stream on every
--     session, and rpc_record_question_attempt copies it onto every answer.
--     Measured 2026-09-23: 441 Class 10 sessions and 3,039 Class 10 answers
--     labelled 'commerce'. Nothing filters on the label today; it was wrong
--     data waiting for a reader.
--
-- One rule, one home on this side: public._stream_for_class. The client
-- holds the same number as FIRST_STREAM_CLASS in src/lib/curriculumScope.ts.
-- An unknown class keeps the stream (the conservative reading, as the client).

CREATE OR REPLACE FUNCTION public._stream_for_class(_stream text, _class int)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $fn$
  SELECT CASE WHEN _class IS NOT NULL AND _class < 11 THEN NULL
              ELSE NULLIF(trim(_stream), '') END;
$fn$;
REVOKE ALL ON FUNCTION public._stream_for_class(text, int) FROM PUBLIC, anon, authenticated;

DO $mig$
DECLARE _def text; _n int; _a text; _b text;
BEGIN
  -- _pick_featured_subject: the class's grade decides whether the school's
  -- stream applies at all.
  SELECT replace(pg_get_functiondef('public._pick_featured_subject(uuid,integer)'::regprocedure), E'\r\n', E'\n') INTO _def;
  _a := $x$  WHERE c.id = _class_id;

  IF _stream = 'commerce' THEN$x$;
  _b := $x$  WHERE c.id = _class_id;

  _stream := public._stream_for_class(_stream, _grade);

  IF _stream = 'commerce' THEN$x$;
  _n := (length(_def) - length(replace(_def, _a, ''))) / length(_a);
  IF _n <> 1 THEN RAISE EXCEPTION '_pick_featured_subject anchor matched % times', _n; END IF;
  EXECUTE replace(_def, _a, _b);

  -- rpc_start_practice_session: store the stream that applies to this class.
  SELECT replace(pg_get_functiondef(p.oid), E'\r\n', E'\n') INTO _def
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND p.proname = 'rpc_start_practice_session';
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
       WHERE ns.nspname = 'public' AND p.proname = 'rpc_start_practice_session') <> 1 THEN
    RAISE EXCEPTION 'rpc_start_practice_session is overloaded; edit the right one by hand';
  END IF;
  _a := $x$    _class := NULLIF(substring(_label from '([0-9]{1,2})'), '')::int;
  END IF;$x$;
  _b := $x$    _class := NULLIF(substring(_label from '([0-9]{1,2})'), '')::int;
  END IF;

  _stream := public._stream_for_class(_stream, _class);$x$;
  _n := (length(_def) - length(replace(_def, _a, ''))) / length(_a);
  IF _n <> 1 THEN RAISE EXCEPTION 'rpc_start_practice_session anchor matched % times', _n; END IF;
  EXECUTE replace(_def, _a, _b);
END
$mig$;

-- The labels already written. Every one came from schools.stream (no Class
-- 9/10 question carries a stream), so clearing them loses nothing true.
UPDATE public.question_attempts SET stream = NULL WHERE class_level < 11 AND stream IS NOT NULL;
UPDATE public.practice_sessions SET stream = NULL WHERE class_level < 11 AND stream IS NOT NULL;
