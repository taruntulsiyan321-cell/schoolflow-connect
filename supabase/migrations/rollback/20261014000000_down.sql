-- Rollback for 20261014000000_a_question_missed_today_was_not_missed_before_today.sql
--
-- Removes the "before this sitting" bound from both places, restoring the
-- behaviour where a mistake row created BY the check being scored counts as a
-- pre-existing mistake.
--
-- What that re-introduces, stated plainly: every unseen question the student
-- gets wrong during a revision check reclassifies itself out of the fresh half
-- mid-count, so the floor rejects the check. Measured live before the fix — a
-- 13-question check (5 mistakes + 8 fresh) was refused with "needs 8 unseen
-- question(s); that sitting answered 1". The worse the student does, the more
-- likely their check is thrown away.

BEGIN;

DO $rewrite$
DECLARE _def text; _new text;
BEGIN
  SELECT replace(pg_get_functiondef(p.oid), E'\r\n', E'\n') INTO _def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.prokind = 'f'
     AND p.proname = 'rpc_submit_revision_session';

  IF _def IS NULL THEN
    RAISE EXCEPTION 'rpc_submit_revision_session not found';
  END IF;

  _new := replace(_def,
    '
         -- BEFORE THIS SITTING. Answering the check writes mistake rows, so
         -- without this every unseen question the student got wrong
         -- reclassified itself into the miss half mid-count.
         AND sm.created_at < _sat_at', '');
  _new := replace(_new,
    '
          -- Same rule as the classification above, for the same reason: a row
          -- this sitting created must not shrink the pool the sitting is
          -- measured against.
          AND sm.created_at < _sat_at', '');

  IF _new = _def THEN
    RAISE EXCEPTION 'neither anchor matched — the substitution would have failed open';
  END IF;

  EXECUTE _new;
END $rewrite$;

DO $check$
DECLARE _def text;
BEGIN
  SELECT replace(pg_get_functiondef(p.oid), E'\r\n', E'\n') INTO _def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'rpc_submit_revision_session';
  IF position('sm.created_at < _sat_at' IN _def) > 0 THEN
    RAISE EXCEPTION 'the sitting bound is still present after the rollback';
  END IF;
END $check$;

COMMIT;
