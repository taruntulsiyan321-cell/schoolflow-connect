-- Rollback for 20260925150000_the_family_is_told_accepted_or_rejected.
--
-- Puts the router and _notify_student_circle back exactly as they were defined
-- before it — the "Work reviewed" / "Work returned" / "Work graded" branch, and
-- a parent linked down both paths told twice — from the definitions the
-- migration copied into routines_pre_20260925150000, whatever line endings they
-- had. Notifications already sent stay sent. Roll back only to undo a
-- deployment.

DO $pre$
BEGIN
  IF to_regclass('public.routines_pre_20260925150000') IS NULL THEN
    RAISE EXCEPTION 'ABORT: routines_pre_20260925150000 is gone, so the definitions cannot be put back exactly. Restore them from a backup instead.';
  END IF;
  -- Something applied since may have redefined either routine; putting the old
  -- definition back would silently undo that too.
  IF EXISTS (SELECT 1 FROM public.routines_pre_20260925150000
              WHERE applied IS DISTINCT FROM pg_get_functiondef(routine::regprocedure)) THEN
    RAISE EXCEPTION 'ABORT: % changed since 20260925150000 was applied. Roll back what changed it first.',
      (SELECT string_agg(routine, ', ') FROM public.routines_pre_20260925150000
        WHERE applied IS DISTINCT FROM pg_get_functiondef(routine::regprocedure));
  END IF;
END
$pre$;

DO $restore$
DECLARE _r record;
BEGIN
  FOR _r IN SELECT routine, definition FROM public.routines_pre_20260925150000 LOOP
    EXECUTE _r.definition;
  END LOOP;
END
$restore$;

DO $verify$
BEGIN
  IF EXISTS (SELECT 1 FROM public.routines_pre_20260925150000
              WHERE definition IS DISTINCT FROM pg_get_functiondef(routine::regprocedure)) THEN
    RAISE EXCEPTION 'ROLLED BACK: % did not come back exactly as it was defined',
      (SELECT string_agg(routine, ', ') FROM public.routines_pre_20260925150000
        WHERE definition IS DISTINCT FROM pg_get_functiondef(routine::regprocedure));
  END IF;
  RAISE NOTICE 'rollback verify OK: the router and _notify_student_circle are back exactly as they were defined';
END
$verify$;

DROP TABLE public.routines_pre_20260925150000;
