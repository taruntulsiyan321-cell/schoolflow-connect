-- TWO FUNCTIONS STILL NEEDED TO READ THE BANK, AND I TOOK IT FROM THEM.
--
-- 20261049000000 dropped qb_select_approved_board so a student can no longer
-- read question_bank. I checked the client's reads and the SECURITY DEFINER
-- functions and concluded nothing else was affected. That was wrong, and the
-- live check caught it:
--
--   rpc_revision_session_plan   -> 400 "there is nothing new left in this
--                                  chapter", for chapters whose own state row
--                                  reported 15, 12 and 20 fresh questions
--   rpc_practice_bank_catalog   -> 200 with ZERO rows, so the practice
--                                  subject/chapter picker was empty
--
-- Both are SECURITY INVOKER and both read question_bank, so with the policy
-- gone they ran as the student and saw an empty bank. Everything else held:
-- rpc_start_practice_session, rpc_start_recovery_session,
-- rpc_submit_revision_session and rpc_student_chapter_states are all
-- definers, which is why the chapter-state count still said 15 while the
-- plan said nothing was left -- the two disagreed because only one of them
-- could see the table.
--
-- THE HELPERS ARE NOT AFFECTED and are deliberately left alone:
-- _recovery_chapter_is_for, _recovery_session_plan_for and
-- _recovery_variant_pool are SECURITY INVOKER too, but they are only ever
-- called from definer parents, and a function called inside a definer
-- context runs with that context's privileges. Recovery was verified working
-- after the policy drop, which is the measurement behind that sentence.
--
-- WHY DEFINER IS SAFE FOR THESE TWO, rather than merely convenient:
--
--   rpc_revision_session_plan scopes every single query by
--   `_uid := auth.uid()` -- it raises when auth.uid() is null, it refuses a
--   chapter not taught to this student's section, and its chapter_state,
--   student_mistakes and question_attempts reads all filter on user_id =
--   _uid. It never leaned on RLS for isolation; it leaned on it only for the
--   bank read, which is the one thing that broke.
--
--   rpc_practice_bank_catalog returns subject, chapter and a COUNT. The bank
--   is global (G2, no school_id), so there is no tenant to isolate, and
--   there is no answer in the result to leak.
--
-- Neither gains access to anything a student could not see before this
-- week; they regain access to what they could.

DO $fix$
DECLARE
  _src text;
  _new text;
BEGIN
  FOR _src IN
    SELECT pg_get_functiondef(r::regprocedure)
    FROM unnest(ARRAY[
      'public.rpc_revision_session_plan(uuid)',
      'public.rpc_practice_bank_catalog(integer,text,text,text)'
    ]) AS r
  LOOP
    IF _src ILIKE '%SECURITY DEFINER%' THEN
      CONTINUE;
    END IF;
    -- Insert the modifier on the line that already carries the volatility
    -- marker, which both of these have.
    _new := replace(_src, E'\n STABLE\n', E'\n STABLE SECURITY DEFINER\n');
    IF _new = _src THEN
      RAISE EXCEPTION 'could not place SECURITY DEFINER; the header is not the shape this expected';
    END IF;
    EXECUTE _new;
  END LOOP;
END
$fix$;

-- Fail closed: both must now be definers, or the student surfaces they feed
-- are still blind.
DO $guard$
DECLARE _bad text;
BEGIN
  SELECT string_agg(p.proname, ', ') INTO _bad
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN ('rpc_revision_session_plan', 'rpc_practice_bank_catalog')
    AND p.prosecdef = false;
  IF _bad IS NOT NULL THEN
    RAISE EXCEPTION '% still cannot read the bank', _bad;
  END IF;
END
$guard$;

INSERT INTO public.schema_migrations (version)
VALUES ('20261050000000_two_invoker_functions_still_needed_to_read_the_bank')
ON CONFLICT (version) DO NOTHING;
