-- Rollback for 20260920010000.
--
-- Recreates the five-argument overload from 20260606000000, verbatim except for
-- the column rename 7.5c applied (`dpp_count` -> `test_count`), so it compiles
-- against today's table.
--
-- THIS RESTORES THE AMBIGUITY. With both signatures present, every
-- five-positional-argument call raises 42725 again:
--
--   rpc_complete_revision     fails outright — marking a revision item complete
--                             aborts after its own UPDATE
--   rpc_finish_battle         loses its activity bump, silently
--
-- Only run this if something is found to depend on the five-argument signature
-- specifically.

CREATE OR REPLACE FUNCTION public._bump_academic_activity(
  _uid uuid, _test int DEFAULT 0, _hw int DEFAULT 0, _battle int DEFAULT 0, _mins int DEFAULT 0
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.academic_daily_activity (user_id, activity_date, test_count, homework_count, battle_count, practice_minutes)
  VALUES (_uid, CURRENT_DATE, _test, _hw, _battle, _mins)
  ON CONFLICT (user_id, activity_date) DO UPDATE SET
    test_count = academic_daily_activity.test_count + EXCLUDED.test_count,
    homework_count = academic_daily_activity.homework_count + EXCLUDED.homework_count,
    battle_count = academic_daily_activity.battle_count + EXCLUDED.battle_count,
    practice_minutes = academic_daily_activity.practice_minutes + EXCLUDED.practice_minutes;
END; $$;
