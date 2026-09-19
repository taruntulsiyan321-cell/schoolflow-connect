-- Rollback for 20261042000000_practice_stays_with_the_student.
--
-- Puts process_academic_event and the USING expression of
-- academic_events_admin_select back exactly as they were before it, from the
-- copies the migration kept in routines_pre_20261042000000.
--
-- NOT reversed, deliberately: the practice rows deleted from
-- school_activity_feed and the practice event payloads that were emptied.
-- They were the leak — every question a student practised, the answer chosen
-- and whether it was right, readable by the whole school. Restoring them would
-- restore the leak, not a state anyone relied on.
--
-- With the old router back, the next practice event from a client older than
-- this commit reaches the feed again. Roll the client back with it only if
-- that is what is intended.

BEGIN;

DO $pre$
BEGIN
  IF to_regclass('public.routines_pre_20261042000000') IS NULL THEN
    RAISE EXCEPTION 'ABORT: routines_pre_20261042000000 is gone, so the definitions cannot be put back exactly. Restore them from a backup instead.';
  END IF;
  -- Something applied since may have changed either; putting the old one back
  -- would silently undo that too.
  IF EXISTS (SELECT 1 FROM public.routines_pre_20261042000000
              WHERE kind = 'function' AND applied IS DISTINCT FROM pg_get_functiondef(object::regprocedure)) THEN
    RAISE EXCEPTION 'ABORT: process_academic_event changed since 20261042000000 was applied. Roll back what changed it first.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.routines_pre_20261042000000 r
              WHERE r.kind = 'policy'
                AND r.applied IS DISTINCT FROM (SELECT pg_get_expr(p.polqual, p.polrelid) FROM pg_policy p
                                                 WHERE p.polrelid = 'public.academic_events'::regclass
                                                   AND p.polname = r.object)) THEN
    RAISE EXCEPTION 'ABORT: academic_events_admin_select changed since 20261042000000 was applied. Roll back what changed it first.';
  END IF;
END
$pre$;

DO $restore$
DECLARE _r record;
BEGIN
  FOR _r IN SELECT object, kind, definition FROM public.routines_pre_20261042000000 LOOP
    IF _r.kind = 'function' THEN
      EXECUTE _r.definition;
    ELSE
      EXECUTE format('ALTER POLICY %I ON public.academic_events USING (%s)', _r.object, _r.definition);
    END IF;
  END LOOP;
END
$restore$;

DO $verify$
BEGIN
  IF EXISTS (SELECT 1 FROM public.routines_pre_20261042000000
              WHERE kind = 'function' AND definition IS DISTINCT FROM pg_get_functiondef(object::regprocedure)) THEN
    RAISE EXCEPTION 'ROLLED BACK: process_academic_event did not come back exactly as it was defined';
  END IF;
  IF EXISTS (SELECT 1 FROM public.routines_pre_20261042000000 r
              WHERE r.kind = 'policy'
                AND r.definition IS DISTINCT FROM (SELECT pg_get_expr(p.polqual, p.polrelid) FROM pg_policy p
                                                    WHERE p.polrelid = 'public.academic_events'::regclass
                                                      AND p.polname = r.object)) THEN
    RAISE EXCEPTION 'ROLLED BACK: academic_events_admin_select did not come back exactly as it was';
  END IF;
  RAISE NOTICE 'rollback OK: the router and the admin read policy are as they were before 20261042000000';
END
$verify$;

DROP TABLE public.routines_pre_20261042000000;
DELETE FROM public.schema_migrations WHERE version = '20261042000000_practice_stays_with_the_student';

COMMIT;
