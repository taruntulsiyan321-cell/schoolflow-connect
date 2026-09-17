-- ROLLBACK for 20261033000000_passing_a_revision_check_is_allowed_to_succeed.
--
-- READ THIS FIRST. This restores a defect that makes the revision ladder
-- unusable for any chapter that reached it through engagement rather than
-- recovery — measured, 4 of 5 chapter_state rows. A student who passes such a
-- check at 92% will have the whole transaction rolled back by
-- chapter_state_recovered_has_timestamp, see a normal result screen, and find
-- their ladder unmoved with no record that they sat anything.
--
-- recovered_at values stamped by the forward migration are NOT cleared: doing
-- so would put rows that are legitimately 'recovered' back in violation of the
-- same constraint. Clear them by hand only alongside a state change.
--
-- Same technique as the forward migration — substitution off the live body,
-- failing closed if the text is not found in both branches.

BEGIN;

DO $$
DECLARE
  _def text;
  _new text;
  _hits int;
  _old_stmt text := E'        state = ''recovered'', recovered_at = COALESCE(_cs.recovered_at, now()), updated_at = now()\n      WHERE user_id = _uid AND chapter_id = _chapter_id;';
  _new_stmt text := E'        state = ''recovered'', updated_at = now()\n      WHERE user_id = _uid AND chapter_id = _chapter_id;';
BEGIN
  SELECT replace(pg_get_functiondef(p.oid), E'\r\n', E'\n') INTO _def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'rpc_submit_revision_session';

  _hits := (length(_def) - length(replace(_def, _old_stmt, ''))) / length(_old_stmt);
  IF _hits <> 2 THEN
    RAISE EXCEPTION 'would have failed open: expected the stamped pass UPDATE twice, found %', _hits;
  END IF;

  _new := replace(_def, _old_stmt, _new_stmt);
  EXECUTE _new;
  RAISE NOTICE 'the pass UPDATE no longer stamps recovered_at; engagement-triggered chapters can no longer pass';
END $$;

COMMIT;
