-- ═══════════════════════════════════════════════════════════════════════════
-- rpc_restore_from_trash could restore ANOTHER SCHOOL'S row
--
-- Found by lint:tenant-scope immediately after 20260904130000 landed, which is
-- the gate doing exactly its job.
--
-- The function is SECURITY DEFINER, so RLS does not apply inside it. Its only
-- guard was has_role(auth.uid(), 'admin') — which asks WHETHER the caller is an
-- admin and never WHICH SCHOOL they administer — and then it updated by primary
-- key:
--
--     UPDATE public.students SET deleted_at = NULL WHERE id = _entity_id;
--
-- Worse, the deadline lookup could not save it. `trash` is a security_invoker
-- view, but inside a DEFINER function the current user IS the owner, so the
-- view returned every school's soft-deleted rows. An admin of school A holding
-- a uuid from school B could restore it, and the audit trail would show a
-- legitimate admin action.
--
-- G13's shape one more time: a definer's reach is decided by its body, not by
-- the policies on the tables it touches.
--
-- THE FIX: every UPDATE now carries `same_school(school_id)`, and the trash
-- lookup does too. same_school() resolves the CALLER's institution, so an
-- entity_id from another school matches no row and the function reports it as
-- not in trash — which, from that admin's point of view, it is not.
--
-- rpc_purge_expired is a different case and is allowlisted instead: it applies
-- G6's uniform retention across all institutions on purpose, has no per-user
-- caller (the body RAISEs when auth.uid() IS NOT NULL), and EXECUTE is granted
-- only to service_role. There is no correct institution for it to scope to.
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

  -- same_school() resolves the CALLER's institution. Without it this lookup
  -- ran as the definer and saw every school's trash.
  SELECT restore_before INTO _deadline
    FROM public.trash
   WHERE entity_type = _entity_type
     AND entity_id = _entity_id
     AND public.same_school(school_id);

  IF _deadline IS NULL THEN
    RAISE EXCEPTION 'not in trash: % %', _entity_type, _entity_id;
  END IF;

  IF _deadline < now() THEN
    RAISE EXCEPTION
      'retention expired for % % (restore_before %); it is awaiting purge',
      _entity_type, _entity_id, _deadline;
  END IF;

  IF _entity_type = 'test' THEN
    UPDATE public.tests SET deleted_at = NULL, deleted_by = NULL
     WHERE id = _entity_id AND public.same_school(school_id);
  ELSIF _entity_type = 'homework' THEN
    UPDATE public.homework SET deleted_at = NULL, deleted_by = NULL
     WHERE id = _entity_id AND public.same_school(school_id);
  ELSIF _entity_type = 'student' THEN
    UPDATE public.students SET deleted_at = NULL, deleted_by = NULL
     WHERE id = _entity_id AND public.same_school(school_id);
  ELSIF _entity_type = 'teacher' THEN
    UPDATE public.teachers SET deleted_at = NULL, deleted_by = NULL
     WHERE id = _entity_id AND public.same_school(school_id);
  ELSE
    RAISE EXCEPTION 'unknown trash entity_type: %', _entity_type;
  END IF;

  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n = 1;
END;
$fn$;

DO $verify$
DECLARE _d text; _n int;
BEGIN
  SELECT pg_get_functiondef(oid) INTO _d FROM pg_proc
   WHERE proname = 'rpc_restore_from_trash' AND pronamespace = 'public'::regnamespace;

  -- Four UPDATEs plus the trash lookup: five predicates, or one path is open.
  SELECT count(*) INTO _n
    FROM regexp_matches(_d, 'same_school\(school_id\)', 'g');
  IF _n < 5 THEN
    RAISE EXCEPTION
      'expected 5 same_school(school_id) predicates (4 updates + the trash lookup), found %', _n;
  END IF;

  IF _d NOT ILIKE '%Admin only%' THEN
    RAISE EXCEPTION 'the admin gate was lost';
  END IF;
END
$verify$;

COMMIT;
