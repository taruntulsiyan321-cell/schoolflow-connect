-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK — remove the trash view, restore the homework-only purge
--
-- Nothing is destroyed: `trash` is a VIEW over deleted_at columns this file
-- never touches, so dropping it removes a lens, not data. The soft-deleted
-- rows stay exactly where they were.
--
-- What DOES regress: three of the four entity types lose their purge. The
-- homework-only job comes back and tests, students and teachers accumulate
-- soft-deleted rows past their G6 window with nothing to remove them.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DROP VIEW IF EXISTS public.trash;
DROP FUNCTION IF EXISTS public.rpc_restore_from_trash(text, uuid);
DROP FUNCTION IF EXISTS public.rpc_purge_expired();
DROP FUNCTION IF EXISTS public.trash_retention_days(text);

CREATE OR REPLACE FUNCTION public.rpc_purge_deleted_homework()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _n int;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION
      'rpc_purge_deleted_homework is a platform maintenance job; it has no per-user caller and deletes across institutions by design';
  END IF;
  WITH gone AS (
    DELETE FROM public.homework
     WHERE deleted_at IS NOT NULL
       AND deleted_at < now() - interval '7 days'
    RETURNING 1
  )
  SELECT count(*) INTO _n FROM gone;
  RETURN _n;
END;
$function$;

DO $verify$
BEGIN
  IF to_regclass('public.trash') IS NOT NULL THEN
    RAISE EXCEPTION 'the trash view survived';
  END IF;
  IF to_regprocedure('public.rpc_purge_deleted_homework()') IS NULL THEN
    RAISE EXCEPTION 'the homework purge was not restored';
  END IF;
END
$verify$;

DELETE FROM public.schema_migrations
 WHERE version IN ('20260904130000_chunk9_trash_registry',
                   '20260904150000_trash_view_grant_fix');

COMMIT;
