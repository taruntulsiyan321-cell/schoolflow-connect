-- ROLLBACK 20261056000000 — every Battleground page view runs the platform-
-- wide featured refresh again (global lock, every class re-seeded), and any
-- signed-in user may call the refresh and rotate directly again.
DO $mig$
DECLARE _def text;
BEGIN
  SELECT replace(pg_get_functiondef('public.rpc_ensure_featured_battles_all()'::regprocedure), E'\r\n', E'\n') INTO _def;
  IF position($x$-- The platform-wide refresh is cron's (hourly), not a page view's.$x$ IN _def) = 0 THEN
    RAISE EXCEPTION 'rpc_ensure_featured_battles_all does not carry 20261056000000';
  END IF;
  EXECUTE replace(_def, E'\n  -- The platform-wide refresh is cron''s (hourly), not a page view''s.\n', $x$
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'rpc_refresh_featured_battles') THEN
      PERFORM public.rpc_refresh_featured_battles();
    ELSIF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'rpc_rotate_featured_battles') THEN
      PERFORM public.rpc_rotate_featured_battles();
    END IF;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
$x$);
END
$mig$;
GRANT EXECUTE ON FUNCTION public.rpc_refresh_featured_battles() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_rotate_featured_battles() TO anon, authenticated;
DELETE FROM public.schema_migrations WHERE version = '20261056000000_opening_battleground_does_not_refresh_every_class';
