-- ROLLBACK of 20261107000000_the_unused_hint_door_is_closed: the function as
-- it stood, with the grants it had (authenticated may execute, anon may not).

BEGIN;

CREATE OR REPLACE FUNCTION public.rpc_question_hint(_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _hint text;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'auth required';
  END IF;
  IF _id IS NULL THEN
    RETURN '';
  END IF;

  -- One row, by primary key. No predicate a caller can steer, so there is
  -- nothing here to enumerate with.
  SELECT COALESCE(q.explanation, '') INTO _hint
  FROM public.question_bank q
  WHERE q.id = _id AND q.is_approved;

  RETURN COALESCE(_hint, '');
END;
$function$;

REVOKE ALL ON FUNCTION public.rpc_question_hint(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_question_hint(uuid) TO authenticated;

DELETE FROM public.schema_migrations WHERE version = '20261107000000_the_unused_hint_door_is_closed';

COMMIT;
