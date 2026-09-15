-- ════════════════════════════════════════════════════════════════════════════
-- A QUESTION MISSED TODAY WAS NOT MISSED BEFORE TODAY
-- ════════════════════════════════════════════════════════════════════════════
--
-- A DEFECT I INTRODUCED IN 20261008000000, FOUND BY SITTING A REAL CHECK
--
-- Driving the app in a browser as arjun.mehta, a revision check for Arithmetic
-- Progressions built correctly — 13 questions, 5 from his mistake book and 8 he
-- had never seen — and then REFUSED TO SUBMIT:
--
--     a revision check needs 8 unseen question(s) from this chapter;
--     that sitting answered 1 (plus 12 from your mistake book)
--
-- He answered 8 unseen questions. The check says 1.
--
-- WHY
--
-- rpc_submit_revision_session classifies a question as a "miss" when this
-- student has a student_mistakes row against it, deliberately ignoring that
-- row's status — because classifying on `status = 'open'` would move a
-- question from one half to the other the moment §4.5 cleared it, and the same
-- sitting would then score differently depending on the order rows happened to
-- be updated in. That reasoning is still right.
--
-- What it missed is that ANSWERING THE CHECK WRITES MISTAKE ROWS. Every unseen
-- question he got wrong became a student_mistakes row during the sitting, so by
-- the time the score was counted those questions were indistinguishable from
-- ones he had missed weeks ago. He got 10 of 13 wrong, so 7 of his 8 fresh
-- questions reclassified themselves out of the fresh half and the floor
-- rejected the whole check.
--
-- The worse the student does, the more likely their check is thrown away. That
-- is the exact opposite of what a retention check is for.
--
-- THE FIX
--
-- A mistake counts as pre-existing only if it was FIRST RECORDED BEFORE THIS
-- SITTING STARTED. student_mistakes.created_at is the first time the question
-- was ever missed — the upsert bumps last_wrong_at and times_wrong, never
-- created_at — so it is exactly the right column, and the comparison is
-- against the practice session's own created_at.
--
--   missed before this sitting  -> the miss half
--   missed only in this sitting -> still the fresh half, because it WAS fresh
--                                  when it was put in front of him
--
-- The same correction applies to the availability count that sets the floor.
-- There it was moving the bar in the forgiving direction, so it hid rather
-- than caused the failure — but it was wrong for the same reason and is fixed
-- for the same reason.
--
-- ROLLBACK: supabase/migrations/rollback/20261014000000_down.sql
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

DO $rewrite$
DECLARE
  _def text;
  _new text;
BEGIN
  SELECT replace(pg_get_functiondef(p.oid), E'\r\n', E'\n') INTO _def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.prokind = 'f'
     AND p.proname = 'rpc_submit_revision_session';

  IF _def IS NULL THEN
    RAISE EXCEPTION 'rpc_submit_revision_session not found';
  END IF;
  IF position(E'\r' IN _def) > 0 THEN
    RAISE EXCEPTION 'a carriage return survived normalisation';
  END IF;

  -- 1. The per-question classification used for the score split.
  _new := replace(_def,
    'SELECT sm.id FROM public.student_mistakes sm
       WHERE sm.user_id = _uid AND sm.question_id = qa.bank_question_id
       LIMIT 1',
    'SELECT sm.id FROM public.student_mistakes sm
       WHERE sm.user_id = _uid AND sm.question_id = qa.bank_question_id
         -- BEFORE THIS SITTING. Answering the check writes mistake rows, so
         -- without this every unseen question the student got wrong
         -- reclassified itself into the miss half mid-count.
         AND sm.created_at < _sat_at
       LIMIT 1');

  IF _new = _def THEN
    RAISE EXCEPTION 'the classification anchor matched nothing — the substitution would have failed open';
  END IF;
  _def := _new;

  -- 2. The availability count that sets the floor.
  _new := replace(_def,
    'AND NOT EXISTS (
       SELECT 1 FROM public.student_mistakes sm
        WHERE sm.user_id = _uid AND sm.question_id = qb.id)',
    'AND NOT EXISTS (
       SELECT 1 FROM public.student_mistakes sm
        WHERE sm.user_id = _uid AND sm.question_id = qb.id
          -- Same rule as the classification above, for the same reason: a row
          -- this sitting created must not shrink the pool the sitting is
          -- measured against.
          AND sm.created_at < _sat_at)');

  IF _new = _def THEN
    RAISE EXCEPTION 'the availability anchor matched nothing — the substitution would have failed open';
  END IF;

  EXECUTE _new;
  RAISE NOTICE 'rpc_submit_revision_session rewritten (both anchors)';
END $rewrite$;

DO $check$
DECLARE _def text; _n int;
BEGIN
  SELECT replace(pg_get_functiondef(p.oid), E'\r\n', E'\n') INTO _def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'rpc_submit_revision_session';

  _n := (length(_def) - length(replace(_def, 'sm.created_at < _sat_at', ''))) / length('sm.created_at < _sat_at');
  IF _n <> 2 THEN
    RAISE EXCEPTION 'expected the sitting bound in 2 places, found %', _n;
  END IF;
END $check$;

COMMIT;
