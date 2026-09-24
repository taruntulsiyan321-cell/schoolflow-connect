-- Rollback 20261072000000 — restore bank-only open-mistake predicate.
-- Re-apply the pre-720 body from git history if needed; this only reverts
-- the count/filter lines via restoring the previous CREATE from ledger tip
-- is not automated. Prefer re-applying 202610090 / later plan migrations.

BEGIN;

-- Narrow back to bank-only counting (lossy for upload sessions that relied on 720).
DO $rewrite$
DECLARE
  _def text;
  _new text;
BEGIN
  SELECT replace(pg_get_functiondef(p.oid), E'\r\n', E'\n') INTO _def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.prokind = 'f'
     AND p.proname = 'rpc_start_recovery_session';
  IF _def IS NULL THEN RETURN; END IF;
  _new := replace(_def,
    'AND sm.status = ''open'' AND (sm.question_id IS NOT NULL OR sm.upload_question_id IS NOT NULL);',
    'AND sm.status = ''open'' AND sm.question_id IS NOT NULL;');
  IF _new <> _def THEN EXECUTE _new; END IF;
END $rewrite$;

-- Full plan body rollback: leave a NOTICE — restore from scripts/_live dump
-- taken before 720 if operators need exact prior function.
DO $$ BEGIN
  RAISE NOTICE '720 rollback: _recovery_session_plan_for not auto-restored; re-apply prior migration body if required';
END $$;

COMMIT;
