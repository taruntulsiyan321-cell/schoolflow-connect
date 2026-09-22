-- A HINT IS ASKED FOR, ONE QUESTION AT A TIME.
--
-- question_bank.explanation is not only the after-the-fact explanation: the
-- practice screen offers it as a HINT before the student answers, behind a
-- reveal that is recorded as hint_used on the attempt. Measured on a real
-- row, hintPreview()'s 120-character truncation does not hide the answer --
--
--   "The seed coat, also called the testa, is a tough layer that shields..."
--
-- names it in the first six words. So the hint is a deliberate answer
-- reveal, with a cost attached.
--
-- The cost was avoidable. A student could read every explanation straight
-- off question_bank, for the whole bank, in one request, and pay nothing.
-- That is the same hole as correct_index and it is why question_bank_student
-- withholds both.
--
-- This gives the hint back as what it always was: a per-question request,
-- made deliberately. It cannot be bulk-dumped and it cannot be filtered on,
-- so the reveal is an action a student takes rather than a column they read.
--
-- WHAT THIS DOES NOT DO, stated rather than implied: it does not make the
-- hint's cost unavoidable. A determined student can call this function
-- directly and never report hint_used, exactly as they could before. Making
-- the charge server-side means recording the hint at the moment it is asked
-- for, against an attempt row that does not exist yet -- a different change,
-- and one that needs a product decision about what a hint costs. The gain
-- here is that the whole bank is no longer readable in one request.

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

REVOKE ALL ON FUNCTION public.rpc_question_hint(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.rpc_question_hint(uuid) TO authenticated;

INSERT INTO public.schema_migrations (version)
VALUES ('20261048000000_a_hint_is_asked_for_one_question_at_a_time')
ON CONFLICT (version) DO NOTHING;
