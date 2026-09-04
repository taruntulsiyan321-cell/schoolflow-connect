-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK — rpc_restore_from_trash loses its tenant fence
--
-- ⚠ THIS REOPENS A CROSS-TENANT WRITE HOLE. READ BEFORE RUNNING.
--
-- The forward migration exists because `lint:tenant-scope` caught the function
-- restoring another school's rows. It is SECURITY DEFINER, so RLS does not
-- apply inside it; its only guard was `has_role(auth.uid(), 'admin')`, which
-- asks WHETHER the caller is an admin and never WHICH SCHOOL they administer.
-- It then updated by primary key alone. The `trash` lookup could not save it
-- either: `trash` is a security_invoker view, but inside a definer the current
-- user IS the owner, so it returned every school's soft-deleted rows.
--
-- Restoring this body means an admin of school A holding a uuid from school B
-- can un-delete school B's student, and the audit trail shows a legitimate
-- admin action. There is no second control behind it — the fence WAS the
-- control.
--
-- `npm run verify:caller-privileges` proves the difference and will go red
-- immediately: the assertion "160000 restore CROSS-TENANT / admin of school A"
-- expects `ERROR: not in trash`, and after this rollback that call succeeds.
-- Run the harness after rolling back so the regression is recorded rather than
-- discovered later.
--
-- Roll back only to unblock something this fence broke, and put the fence back
-- in the same session. No data is touched either way; this is a function body.
--
-- ── Why this file did not ship with the migration ─────────────────────────
--
-- It should have. `npm run preflight` reported it as the one migration
-- "APPLIED WITH NO ROLLBACK SCRIPT", which is preflight question 3 doing its
-- job — the gate was right and the previous session was wrong. Written now,
-- after the fact, from the body 20260904130000 originally installed.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.rpc_restore_from_trash(_entity_type text, _entity_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
DECLARE
  _n int := 0;
  _deadline timestamptz;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Admin only';  -- G6: restorable by Admin
  END IF;

  SELECT restore_before INTO _deadline
    FROM public.trash
   WHERE entity_type = _entity_type AND entity_id = _entity_id;

  IF _deadline IS NULL THEN
    RAISE EXCEPTION 'not in trash: % %', _entity_type, _entity_id;
  END IF;

  -- Past the deadline the row is only still here because the purge has not run
  -- yet. Restoring it would make the retention window mean "until someone
  -- notices" instead of the number G6 states.
  IF _deadline < now() THEN
    RAISE EXCEPTION
      'retention expired for % % (restore_before %); it is awaiting purge',
      _entity_type, _entity_id, _deadline;
  END IF;

  IF _entity_type = 'test' THEN
    UPDATE public.tests SET deleted_at = NULL, deleted_by = NULL WHERE id = _entity_id;
  ELSIF _entity_type = 'homework' THEN
    UPDATE public.homework SET deleted_at = NULL, deleted_by = NULL WHERE id = _entity_id;
  ELSIF _entity_type = 'student' THEN
    UPDATE public.students SET deleted_at = NULL, deleted_by = NULL WHERE id = _entity_id;
  ELSIF _entity_type = 'teacher' THEN
    UPDATE public.teachers SET deleted_at = NULL, deleted_by = NULL WHERE id = _entity_id;
  ELSE
    RAISE EXCEPTION 'unknown trash entity_type: %', _entity_type;
  END IF;

  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n = 1;
END;
$fn$;

-- Confirm the rollback did what it says, rather than half-applying. This
-- asserts the fence is GONE — the inverse of the forward migration's check —
-- so a partial edit that left some predicates behind fails loudly.
DO $verify$
DECLARE _d text; _n int;
BEGIN
  SELECT pg_get_functiondef(oid) INTO _d FROM pg_proc
   WHERE proname = 'rpc_restore_from_trash' AND pronamespace = 'public'::regnamespace;

  SELECT count(*) INTO _n FROM regexp_matches(_d, 'same_school\(school_id\)', 'g');
  IF _n <> 0 THEN
    RAISE EXCEPTION
      'rollback incomplete: % same_school(school_id) predicate(s) survive', _n;
  END IF;

  IF _d NOT ILIKE '%Admin only%' THEN
    RAISE EXCEPTION 'the admin gate was lost; this rollback must not weaken it further';
  END IF;
END
$verify$;

DELETE FROM public.schema_migrations
 WHERE version = '20260904160000_trash_restore_tenant_fence';

COMMIT;
