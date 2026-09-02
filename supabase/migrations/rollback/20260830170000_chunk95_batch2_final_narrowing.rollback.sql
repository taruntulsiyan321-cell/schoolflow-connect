-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK — chunk 9.5 batch 2 final narrowing
-- Undoes 20260830170000_chunk95_batch2_final_narrowing.sql
--
-- That migration was itself a RESTORE: batch 1 had revoked EXECUTE too widely,
-- and it granted EXECUTE back on seven functions the verification suite calls
-- as a real role. So this rollback re-revokes those seven.
--
-- ⚠ What that means in practice: rolling back re-breaks the verification files
-- that call these seven, and three of them are live product actions —
-- rpc_respond_to_invitation is Chunk 1's "Accept / Decline / This isn't me".
-- Re-revoking takes those actions down for every non-service caller. This file
-- exists for completeness of the chain, not because running it is ever likely
-- to be the right move.
--
-- The migration also contained two assertion blocks (the 32 that stay closed,
-- and the item-3a read check). Assertions have nothing to undo.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $rerevoke$
DECLARE r record; _n int := 0;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure::text AS sig
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname = ANY (ARRAY['admin_connect_teacher_account',
         'admin_set_unique_role',
         'chat_caller_role',
         'effective_role',
         'get_user_role',
         'rpc_parent_child_snapshot',
         'rpc_respond_to_invitation'])
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon, authenticated', r.sig);
    _n := _n + 1;
  END LOOP;

  -- Same failure the forward migration guards against: if the list no longer
  -- matches anything, the file is stale and silently did nothing.
  IF _n = 0 THEN
    RAISE EXCEPTION 'rollback: none of the seven was found; the list is stale.';
  END IF;
  RAISE NOTICE 'rollback: re-revoked EXECUTE on % signature(s).', _n;
END
$rerevoke$;

-- Assert the revoke actually landed. REVOKE reports nothing when it closes
-- nothing, so the outcome is checked rather than the statement.
DO $verify$
DECLARE _open text;
BEGIN
  SELECT string_agg(p.proname, ', ') INTO _open
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = ANY (ARRAY['admin_connect_teacher_account',
       'admin_set_unique_role',
       'chat_caller_role',
       'effective_role',
       'get_user_role',
       'rpc_parent_child_snapshot',
       'rpc_respond_to_invitation'])
     AND (has_function_privilege('authenticated', p.oid, 'EXECUTE')
       OR has_function_privilege('anon', p.oid, 'EXECUTE'));

  IF _open IS NOT NULL THEN
    RAISE EXCEPTION 'rollback did not close: %', _open;
  END IF;
END
$verify$;

COMMIT;
