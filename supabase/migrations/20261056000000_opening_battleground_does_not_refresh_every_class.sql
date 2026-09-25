-- #5 — practice saves failed when the database was busy. What made it busy:
--
-- pg_stat_statements, 2026-09-23: rpc_ensure_featured_battles_all was the
-- heaviest statement in the database by a wide margin — 13,183 calls, mean
-- 892 ms, max 4,467 ms, 11,755 s in total, more than every other statement
-- combined. Two defects, one on each side:
--
--   * the client called it in a loop (fixed in battleExperienceService.ts —
--     one open Battleground page made 274 calls a minute, now 1);
--   * and every call began with rpc_refresh_featured_battles(): a
--     PLATFORM-WIDE job that takes a global advisory lock, closes expired
--     featured battles everywhere and re-seeds them for EVERY class. So each
--     student opening Battleground queued behind every other one and redid
--     the whole platform's work.
--
-- That job already runs from cron every hour (jobid 1, '5 * * * *', 24 of 24
-- succeeded in the last day). The per-student call keeps only what is its
-- own: seed this class's three cards and read them back.
--
-- And a signed-in user can no longer call the platform-wide refresh or
-- rotate directly: nothing in the app does any more, cron runs as the owner,
-- and the definer functions that call them are unaffected by the grant.
DO $mig$
DECLARE _def text; _n int;
  _a text := $x$
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'rpc_refresh_featured_battles') THEN
      PERFORM public.rpc_refresh_featured_battles();
    ELSIF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'rpc_rotate_featured_battles') THEN
      PERFORM public.rpc_rotate_featured_battles();
    END IF;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
$x$;
BEGIN
  SELECT replace(pg_get_functiondef('public.rpc_ensure_featured_battles_all()'::regprocedure), E'\r\n', E'\n') INTO _def;
  _n := (length(_def) - length(replace(_def, _a, ''))) / length(_a);
  IF _n <> 1 THEN RAISE EXCEPTION 'rpc_ensure_featured_battles_all refresh block matched % times', _n; END IF;
  EXECUTE replace(_def, _a, E'\n  -- The platform-wide refresh is cron''s (hourly), not a page view''s.\n');
END
$mig$;

REVOKE EXECUTE ON FUNCTION public.rpc_refresh_featured_battles() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.rpc_rotate_featured_battles() FROM PUBLIC, anon, authenticated;
