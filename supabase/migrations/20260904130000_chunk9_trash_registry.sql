-- ═══════════════════════════════════════════════════════════════════════════
-- CHUNK 9 — trash: a VIEW, not a second table, plus one purge and one restore
--
-- ── THE CONVERGENCE, WHICH IS WHY THIS IS NOT A NEW TABLE ─────────────────
--
-- The spec describes `trash` as a table:
--
--     entity_type · entity_id · deleted_at · deleted_by · restore_before
--
-- Chunk 5 had already built the other design: `deleted_at` / `deleted_by`
-- columns on tests, homework, students and teachers, each hidden by a
-- RESTRICTIVE policy. Creating the table now would put "when was this deleted"
-- in two places — G9, deliberately, with a trigger to keep them agreeing.
--
-- So `trash` is a VIEW over the columns that already hold the fact. Nothing to
-- keep in sync, nothing to drift, and the registry shape the spec asked for.
--
-- `restore_before` is DERIVED, not stored, for the same reason: it is
-- `deleted_at + retention(entity_type)`, and storing it would let a row's
-- deadline disagree with its own deletion date.
--
-- ── security_invoker, AND WHY THE ACCESS RULE NEEDED NO NEW CODE ──────────
--
-- The four hiding policies already read
--
--     (deleted_at IS NULL) OR has_role(auth.uid(), 'admin')
--
-- so an admin can already see soft-deleted rows and nobody else can. G6 says
-- restorable by Admin. The view is declared `security_invoker = true`, so it
-- inherits exactly that — an admin sees the trash, everyone else sees an empty
-- view. No new grant, no new policy, no definer door.
--
-- ── RETENTION IS DECLARED ONCE ────────────────────────────────────────────
--
-- G6:  Test 7d · Homework 7d · Student 30d · Teacher 30d · Resource hard-delete.
--
-- trash_retention_days() is the single home. The view, the purge and the
-- restore all call it, so changing a retention period changes what the UI
-- promises, what the job deletes and what the restore refuses — together. The
-- previous shape had 7 days written into rpc_purge_deleted_homework and
-- nowhere else, so nothing else could agree with it.
--
-- RESOURCES ARE ABSENT FROM ALL OF THIS, deliberately. §10.11: "Permanent
-- deletion — no trash." A resource must never appear here, and the
-- verification asserts the view cannot emit one.
--
-- ── messages AND teacher_remarks ALSO HAVE deleted_at, AND ARE NOT TRASH ──
--
-- Both carry the columns; neither is in G6's table. A deleted chat message is
-- a chat feature, and §10.14 gives a teacher an outright delete on their own
-- remark. Including them would put rows in an admin restore queue that the
-- spec never said were restorable. Named here so their absence reads as a
-- decision rather than an oversight.
--
-- ── rpc_purge_deleted_homework IS REPLACED ────────────────────────────────
--
-- It purged one of the four entity types on a hardcoded 7 days. Keeping it
-- beside a generic purge would be two homes for "expire homework". Dropped;
-- rpc_purge_expired covers all four and returns a per-type breakdown so a
-- scheduler's log says what it actually removed.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── Retention, the single home ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.trash_retention_days(_entity_type text)
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $fn$
  SELECT CASE _entity_type
           WHEN 'test'     THEN 7
           WHEN 'homework' THEN 7
           WHEN 'student'  THEN 30
           WHEN 'teacher'  THEN 30
         END
$fn$;

COMMENT ON FUNCTION public.trash_retention_days(text) IS
  'G6 retention in days. NULL for any entity that does not go to trash - '
  'resources are hard-deleted (§10.11) and must never return a number here.';

-- ── The registry ──────────────────────────────────────────────────────────
DROP VIEW IF EXISTS public.trash;
CREATE VIEW public.trash WITH (security_invoker = true) AS
SELECT 'test'::text AS entity_type, t.id AS entity_id, t.school_id,
       t.deleted_at, t.deleted_by,
       t.deleted_at + (public.trash_retention_days('test') || ' days')::interval AS restore_before,
       COALESCE(NULLIF(t.title, ''), NULLIF(t.topic, ''), 'Test') AS label
  FROM public.tests t
 WHERE t.deleted_at IS NOT NULL
UNION ALL
SELECT 'homework', h.id, h.school_id, h.deleted_at, h.deleted_by,
       h.deleted_at + (public.trash_retention_days('homework') || ' days')::interval,
       COALESCE(NULLIF(h.title, ''), 'Homework')
  FROM public.homework h
 WHERE h.deleted_at IS NOT NULL
UNION ALL
SELECT 'student', s.id, s.school_id, s.deleted_at, s.deleted_by,
       s.deleted_at + (public.trash_retention_days('student') || ' days')::interval,
       COALESCE(NULLIF(s.full_name, ''), 'Student')
  FROM public.students s
 WHERE s.deleted_at IS NOT NULL
UNION ALL
SELECT 'teacher', te.id, te.school_id, te.deleted_at, te.deleted_by,
       te.deleted_at + (public.trash_retention_days('teacher') || ' days')::interval,
       COALESCE(NULLIF(te.full_name, ''), 'Teacher')
  FROM public.teachers te
 WHERE te.deleted_at IS NOT NULL;

COMMENT ON VIEW public.trash IS
  'Soft-deleted rows awaiting purge. A VIEW over the deleted_at columns Chunk 5 '
  'built, not a second copy of them. security_invoker: the underlying hiding '
  'policies already restrict soft-deleted rows to admin (G6). Resources are '
  'never here - §10.11 hard-deletes them.';

GRANT SELECT ON public.trash TO authenticated;

-- ── Restore ───────────────────────────────────────────────────────────────
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

REVOKE EXECUTE ON FUNCTION public.rpc_restore_from_trash(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_restore_from_trash(text, uuid) TO authenticated, service_role;

-- ── Purge ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_purge_expired()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
DECLARE
  _tests int; _homework int; _students int; _teachers int;
BEGIN
  -- Same rule as the homework purge it replaces: no per-user caller. A
  -- logged-in user reaching this would be deleting other institutions' rows,
  -- and there is no correct institution to scope to.
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION
      'rpc_purge_expired is a platform maintenance job; it has no per-user caller and deletes across institutions by design';
  END IF;

  WITH gone AS (
    DELETE FROM public.tests
     WHERE deleted_at IS NOT NULL
       AND deleted_at < now() - (public.trash_retention_days('test') || ' days')::interval
    RETURNING 1) SELECT count(*) INTO _tests FROM gone;

  WITH gone AS (
    DELETE FROM public.homework
     WHERE deleted_at IS NOT NULL
       AND deleted_at < now() - (public.trash_retention_days('homework') || ' days')::interval
    RETURNING 1) SELECT count(*) INTO _homework FROM gone;

  WITH gone AS (
    DELETE FROM public.students
     WHERE deleted_at IS NOT NULL
       AND deleted_at < now() - (public.trash_retention_days('student') || ' days')::interval
    RETURNING 1) SELECT count(*) INTO _students FROM gone;

  WITH gone AS (
    DELETE FROM public.teachers
     WHERE deleted_at IS NOT NULL
       AND deleted_at < now() - (public.trash_retention_days('teacher') || ' days')::interval
    RETURNING 1) SELECT count(*) INTO _teachers FROM gone;

  RETURN jsonb_build_object(
    'tests', _tests, 'homework', _homework,
    'students', _students, 'teachers', _teachers,
    'purged_at', now()
  );
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.rpc_purge_expired() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_purge_expired() TO service_role;

DROP FUNCTION IF EXISTS public.rpc_purge_deleted_homework();

-- ── Assert the outcome, not the statements ────────────────────────────────
DO $verify$
DECLARE _n int;
BEGIN
  IF to_regclass('public.trash') IS NULL THEN
    RAISE EXCEPTION 'the trash view does not exist';
  END IF;

  -- It must be a VIEW. A table here would be the G9 this migration exists to
  -- avoid, and a later "optimisation" into a table would be silent.
  IF (SELECT relkind FROM pg_class WHERE oid = 'public.trash'::regclass) <> 'v' THEN
    RAISE EXCEPTION 'trash is not a view; deleted_at now has two homes';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_class
     WHERE oid = 'public.trash'::regclass
       AND reloptions @> ARRAY['security_invoker=true']
  ) THEN
    RAISE EXCEPTION
      'trash is not security_invoker; it would show every school''s deleted rows to anyone';
  END IF;

  -- §10.11: a resource must never be restorable.
  IF public.trash_retention_days('resource') IS NOT NULL THEN
    RAISE EXCEPTION 'resources have a retention period; §10.11 says hard delete';
  END IF;
  IF EXISTS (SELECT 1 FROM public.trash WHERE entity_type = 'resource') THEN
    RAISE EXCEPTION 'a resource appeared in trash';
  END IF;

  -- G6's four, and only those four.
  SELECT count(DISTINCT entity_type) INTO _n
    FROM (SELECT unnest(ARRAY['test','homework','student','teacher']) AS entity_type) g
   WHERE public.trash_retention_days(g.entity_type) IS NOT NULL;
  IF _n <> 4 THEN
    RAISE EXCEPTION 'expected 4 retained entity types, found %', _n;
  END IF;

  IF public.trash_retention_days('test') <> 7
     OR public.trash_retention_days('homework') <> 7
     OR public.trash_retention_days('student') <> 30
     OR public.trash_retention_days('teacher') <> 30 THEN
    RAISE EXCEPTION 'retention does not match G6 (7/7/30/30)';
  END IF;

  -- The replaced function must be gone, or "expire homework" has two homes.
  IF to_regprocedure('public.rpc_purge_deleted_homework()') IS NOT NULL THEN
    RAISE EXCEPTION 'rpc_purge_deleted_homework survived alongside rpc_purge_expired';
  END IF;

  IF to_regprocedure('public.rpc_purge_expired()') IS NULL
     OR to_regprocedure('public.rpc_restore_from_trash(text, uuid)') IS NULL THEN
    RAISE EXCEPTION 'the purge or restore function is missing';
  END IF;

  -- The purge must not be reachable by a signed-in user.
  IF has_function_privilege('authenticated', 'public.rpc_purge_expired()'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated can execute rpc_purge_expired';
  END IF;
END
$verify$;

COMMIT;
