-- ROLLBACK for 20261037000000_a_session_that_asked_nothing_keeps_claiming_nothing.
--
-- READ THIS FIRST. This restores the behaviour in which a practice session
-- that showed the student nothing records itself as a full session — the
-- requested question count, zero correct — and every reader downstream has to
-- know to disbelieve it.
--
-- The rows corrected on the way are NOT restored: their question_count was set
-- to 0 because they have no attempts, and putting a fabricated count back
-- would mean choosing a number this file does not hold.

BEGIN;

DO $$
DECLARE
  _def text;
  _new text;
BEGIN
  SELECT replace(pg_get_functiondef(p.oid), E'\r\n', E'\n') INTO _def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'rpc_finish_practice_session';

  _new := replace(_def,
    'question_count = _total,',
    'question_count = CASE WHEN _total > 0 THEN _total ELSE ps.question_count END,');

  IF _new = _def THEN
    RAISE EXCEPTION 'would have failed open: the unconditional question_count was not found';
  END IF;

  EXECUTE _new;
  RAISE NOTICE 'the finish again keeps the requested count when nothing was attempted';
END $$;

COMMIT;
