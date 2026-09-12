-- ═══════════════════════════════════════════════════════════════════════════
-- One activity bump, not two (G9)
--
-- `_bump_academic_activity` exists twice:
--
--   20260606000000   (_uid uuid, _test int, _hw int, _battle int, _mins int)
--   20260614000000   (_uid uuid, _test int, _hw int, _battle int, _mins int,
--                     _self_practice int DEFAULT 0)
--
-- The second is the first plus one defaulted column. FIVE POSITIONAL ARGUMENTS
-- MATCH BOTH, so every five-argument call resolves to neither:
--
--     SELECT public._bump_academic_activity(<uuid>, 0, 0, 0, 5);
--     ERROR:  function public._bump_academic_activity(uuid, integer, integer,
--             integer, integer) is not unique                        (42725)
--
-- Measured on the three callers that pass five:
--
--   rpc_test_submit               wrapped -> WARNING, swallowed. A student who
--                                 submitted a test had no daily activity row at
--                                 all, and their weekly activity chart showed
--                                 no tests. (Fixed in 20260920000000 by naming
--                                 the six-argument form; this removes the
--                                 ambiguity it was working around.)
--   rpc_finish_battle             wrapped -> WARNING, swallowed. Same loss.
--   rpc_complete_revision         NOT WRAPPED. The exception aborts the whole
--                                 function AFTER its UPDATE, so the transaction
--                                 rolls back and marking a revision item
--                                 complete fails outright, every time.
--
-- `rpc_finish_practice_session` passes six and has always worked, which is why
-- `academic_daily_activity` has rows at all and the defect stayed invisible.
--
-- ── WHY DROP RATHER THAN RENAME OR PATCH THE CALLERS ─────────────────────
--
-- The five-argument body is a strict subset of the six-argument one: same
-- INSERT, same ON CONFLICT arithmetic, one column fewer. Two bodies describing
-- one fact is the duplication G9 is about, and "fix the callers" would leave the
-- trap in place for the next one. Dropping it leaves exactly one function, and
-- a five-positional-argument call then resolves to it unambiguously — so all
-- three callers above are repaired without being edited.
--
-- The dropped signature has no dependent objects: a PERFORM inside a plpgsql
-- body is resolved at run time, not recorded as a dependency, which is why this
-- drop is possible at all and also why nothing warned about the ambiguity.
--
-- Rollback: supabase/migrations/rollback/
--           20260920010000_one_activity_bump_not_two.rollback.sql
-- ═══════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public._bump_academic_activity(uuid, integer, integer, integer, integer);

COMMENT ON FUNCTION public._bump_academic_activity(uuid, integer, integer, integer, integer, integer) IS
  'The only activity bump. A five-argument overload existed alongside it from '
  '20260606000000 to 20260920010000 and made every five-positional-argument '
  'call ambiguous (42725) — see that migration.';

-- ── Proof ─────────────────────────────────────────────────────────────────
DO $verify$
DECLARE
  _uid uuid;
  _sigs int;
  _before int; _after int; _had_row boolean;
BEGIN
  SELECT count(*)::int INTO _sigs
    FROM pg_proc WHERE pronamespace = 'public'::regnamespace
     AND proname = '_bump_academic_activity';

  IF _sigs <> 1 THEN
    RAISE EXCEPTION 'ROLLED BACK: % signature(s) of _bump_academic_activity remain, expected exactly 1', _sigs;
  END IF;

  -- The positive control, and the whole point: a five-positional-argument call
  -- now resolves. This is the exact call `rpc_complete_revision` makes, and it
  -- raised 42725 before this migration.
  SELECT s.user_id INTO _uid
    FROM public.students s WHERE s.user_id IS NOT NULL LIMIT 1;
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'ROLLED BACK: no student with an account — the call below would prove nothing';
  END IF;

  SELECT practice_minutes, true INTO _before, _had_row
    FROM public.academic_daily_activity
   WHERE user_id = _uid AND activity_date = CURRENT_DATE;
  _before := COALESCE(_before, 0);
  _had_row := COALESCE(_had_row, false);

  PERFORM public._bump_academic_activity(_uid, 0, 0, 0, 5);

  SELECT practice_minutes INTO _after
    FROM public.academic_daily_activity
   WHERE user_id = _uid AND activity_date = CURRENT_DATE;

  IF COALESCE(_after, 0) <> _before + 5 THEN
    RAISE EXCEPTION 'ROLLED BACK: the five-argument call did not add its 5 minutes (% -> %)', _before, _after;
  END IF;

  -- Put the row back exactly as it was found.
  IF _had_row THEN
    UPDATE public.academic_daily_activity SET practice_minutes = _before
     WHERE user_id = _uid AND activity_date = CURRENT_DATE;
  ELSE
    DELETE FROM public.academic_daily_activity
     WHERE user_id = _uid AND activity_date = CURRENT_DATE;
  END IF;

  RAISE NOTICE 'verify OK: one signature left, and a five-positional-argument call resolves and adds its minutes';
END
$verify$;
