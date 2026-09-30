-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK: the two recovery helpers granted to clients again
--
-- Puts back exactly what 20261123000000 took away: EXECUTE for authenticated
-- on _recovery_session_plan_for and rpc_recovery_session_plan. anon and PUBLIC
-- are NOT re-granted — neither had a reason to hold it, and restoring a grant
-- nobody asked for is not a rollback.
--
-- Note what you are restoring: as of 20261118000000 both refuse every client
-- with 42501 on variant_generation_queue, so this re-opens a door that cannot
-- answer.
--
-- Undoes: 20261123000000_a_door_that_cannot_answer_is_closed.sql
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

GRANT EXECUTE ON FUNCTION public._recovery_session_plan_for(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_recovery_session_plan(uuid) TO authenticated;

DO $check$
BEGIN
  IF NOT has_function_privilege('authenticated', 'public._recovery_session_plan_for(uuid,uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.rpc_recovery_session_plan(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'the grants did not come back';
  END IF;
END
$check$;

DELETE FROM public.schema_migrations
 WHERE version = '20261123000000_a_door_that_cannot_answer_is_closed';

COMMIT;
