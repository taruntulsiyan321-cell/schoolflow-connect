-- Rollback for 20260925120000.
--
-- Restores the drain as it was: no scheduler, pending and failed rows taken in
-- created_at order, and both queue functions executable by any signed-in
-- session. Grants are restored as the live project held them on 2026-09-13
-- (authenticated and service_role; not PUBLIC or anon). The app on this branch
-- no longer drains the queue from the browser, so after this rollback class
-- recounts wait until the browser drain is restored too.

SELECT cron.unschedule('process-pending-academic-events')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'process-pending-academic-events');

CREATE OR REPLACE FUNCTION public.process_pending_academic_events(_limit integer DEFAULT 50)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r record;
  _n int := 0;
  _lim int := greatest(1, least(coalesce(_limit, 50), 200));
BEGIN
  FOR r IN
    SELECT id FROM public.academic_events
    WHERE status IN ('pending', 'failed')
    ORDER BY created_at ASC
    LIMIT _lim
    FOR UPDATE SKIP LOCKED
  LOOP
    IF public.process_academic_event(r.id) THEN
      _n := _n + 1;
    END IF;
  END LOOP;
  RETURN _n;
END;
$function$;

COMMENT ON FUNCTION public.process_pending_academic_events(integer) IS
  'Drain pending/failed academic_events (batch / recovery)';

GRANT EXECUTE ON FUNCTION public.process_pending_academic_events(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.process_academic_event(uuid) TO authenticated;
