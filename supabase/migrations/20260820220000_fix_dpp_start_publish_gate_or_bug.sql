-- BUG: rpc_dpp_start computed _published as
--   COALESCE(is_published, false) OR lower(COALESCE(status,'')) = 'published'
-- an OR of two flags that every real app write path (TestService.create/
-- update/publish/archive/schedule) always keeps in lockstep -- meaning the
-- OR can only ever add risk, never legitimate coverage. Live-confirmed: a
-- seeded draft DPP ("Draft DPP — Light (unpublished)", is_published=false,
-- status='published') was fully startable and submittable by a real student
-- (arjun.mehta) through the real RPC -- a genuine, exploitable authorization
-- bug, not just a display inconsistency. The matching client-side check
-- (testService.ts's isPublishedFlag, used by TestService.get/listForClass/
-- listQuestions, and gurukul/pages/Tests.tsx's own duplicate of the same
-- logic) had the identical OR bug and is fixed separately in the same pass
-- to trust is_published alone -- this migration closes the same hole at the
-- actual authorization boundary (the RPC), which is what a malicious client
-- calling the RPC directly (bypassing all client code) would actually hit.
--
-- Teacher/admin/principal preview access (the block below this one) is
-- unaffected -- they can already start a preview attempt on an unpublished
-- test regardless of _published.

CREATE OR REPLACE FUNCTION public.rpc_dpp_start(_dpp_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _aid uuid;
  _sid uuid;
  _max numeric;
  _cnt int;
  _published boolean := false;
  _class uuid;
  _status text;
  _school uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'auth required';
  END IF;

  SELECT
    COALESCE(is_published, false),
    class_id,
    status,
    school_id
  INTO _published, _class, _status, _school
  FROM public.dpps
  WHERE id = _dpp_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Test not found';
  END IF;

  IF NOT _published THEN
    -- Teachers / operators may still preview via service paths; students may not start.
    IF NOT (
      public.has_role(auth.uid(), 'teacher')
      OR public.has_role(auth.uid(), 'admin')
      OR public.has_role(auth.uid(), 'principal')
    ) THEN
      RAISE EXCEPTION 'This test is not published yet';
    END IF;
  END IF;

  SELECT id INTO _sid FROM public.students WHERE user_id = auth.uid() LIMIT 1;
  IF _sid IS NOT NULL AND _class IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.students s
      WHERE s.id = _sid AND s.class_id = _class
    ) THEN
      -- Allow teachers starting preview attempts without class membership
      IF NOT (
        public.has_role(auth.uid(), 'teacher')
        OR public.has_role(auth.uid(), 'admin')
        OR public.has_role(auth.uid(), 'principal')
      ) THEN
        RAISE EXCEPTION 'Not enrolled in this class';
      END IF;
    END IF;
  END IF;

  SELECT COALESCE(SUM(marks), 0), count(*)
  INTO _max, _cnt
  FROM public.dpp_questions
  WHERE dpp_id = _dpp_id;

  INSERT INTO public.dpp_attempts (dpp_id, user_id, student_id, max_score, total_count, school_id)
  VALUES (_dpp_id, auth.uid(), _sid, _max, _cnt, _school)
  ON CONFLICT (dpp_id, user_id) DO UPDATE
    SET max_score = EXCLUDED.max_score,
        total_count = EXCLUDED.total_count
  RETURNING id INTO _aid;

  RETURN _aid;
END;
$function$;
