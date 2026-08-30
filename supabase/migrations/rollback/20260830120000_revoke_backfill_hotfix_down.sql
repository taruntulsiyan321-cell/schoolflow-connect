-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK for 20260830120000_revoke_backfill_hotfix.sql
--
-- Restores EXECUTE on the three _backfill_* functions to PUBLIC, anon and
-- authenticated.
--
-- READ THIS BEFORE RUNNING IT. This rollback REOPENS a measured hole: it makes
-- _backfill_battle_question_concepts() -- 749 tuples written across shared
-- battle question data, no arguments, no caller -- callable again by every
-- signed-in student. There is no configuration in which that is desirable.
--
-- It exists because every migration in this project gets one, and because a
-- rollback that does not exist is a rollback nobody can review. Run it only to
-- restore a known-good prior state during an incident, never to "undo a
-- permissions change that broke something" -- nothing calls these three, so
-- nothing they could break is caused by this migration.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $restore$
DECLARE
  _fn text;
  _fns text[] := ARRAY[
    '_backfill_battle_question_concepts',
    '_backfill_question_bank_concepts',
    '_backfill_template_concepts'
  ];
BEGIN
  FOREACH _fn IN ARRAY _fns LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = _fn AND p.pronargs = 0
    ) THEN
      RAISE EXCEPTION 'public.%() does not exist; nothing to restore', _fn;
    END IF;
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I() TO PUBLIC', _fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I() TO anon', _fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I() TO authenticated', _fn);
  END LOOP;
END
$restore$;

DO $guard$
DECLARE _oid oid;
BEGIN
  SELECT p.oid INTO _oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = '_backfill_battle_question_concepts' AND p.pronargs = 0;
  IF NOT has_function_privilege('authenticated', _oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'rollback did not restore the authenticated grant';
  END IF;
END
$guard$;

COMMIT;
