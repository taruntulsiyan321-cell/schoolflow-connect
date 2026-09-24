-- ROLLBACK 20261011000000_the_student_may_actually_call_it — the file that migration names in its header, and which
-- was never written until 2026-09-22.
--
-- Takes back the three EXECUTE grants it gave `authenticated`. THIS RESTORES THE DEFECT IT FIXED: every student
-- calling rpc_revision_session_plan — the only way to start a revision check — gets "permission denied for
-- function", and rpc_recovery_session_plan / _recovery_chapter_is_mine, one-line invoker delegations, fail the same
-- way on the inner functions. Run it only together with the migrations that built on it (20261050000000 and later),
-- newest first.
--
-- NOT REVERSED, deliberately: the REVOKEs on _ensure_recovery_session and _apply_chapter_state. They are SECURITY
-- DEFINER background steps of the practice finish; a student able to call them could prepare recovery sessions and
-- move chapter state at will. Putting EXECUTE back would open a door, not restore a state anyone relied on.
REVOKE EXECUTE ON FUNCTION public.rpc_revision_session_plan(uuid)        FROM authenticated;
REVOKE EXECUTE ON FUNCTION public._recovery_chapter_is_for(uuid, uuid)   FROM authenticated;
REVOKE EXECUTE ON FUNCTION public._recovery_session_plan_for(uuid, uuid) FROM authenticated;

DO $check$
DECLARE _still text;
BEGIN
  SELECT string_agg(f, ', ') INTO _still
    FROM unnest(ARRAY['public.rpc_revision_session_plan(uuid)', 'public._recovery_chapter_is_for(uuid,uuid)',
                      'public._recovery_session_plan_for(uuid,uuid)']) f
   WHERE has_function_privilege('authenticated', f::regprocedure, 'EXECUTE');
  IF _still IS NOT NULL THEN
    RAISE EXCEPTION 'rollback: authenticated can still execute %', _still;
  END IF;
END
$check$;

DELETE FROM public.schema_migrations
 WHERE version = '20261011000000_the_student_may_actually_call_it';
